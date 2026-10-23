import AppError from '../errors/AppError.js';
import { ZONA_HORARIA_NEGOCIO } from '../config/ventas.js';
import { PORCIONES_TAMANO, UNIDADES_ESCALABLES } from '../config/produccion.js';
import normalizarCategoria from './normalizarCategoria.js';
import { convertirUnidad, normalizarPasos } from './insumos.js';

export function fechaHoraBogota(fecha = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_HORARIA_NEGOCIO,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(fecha);
  const valor = Object.fromEntries(partes.map((parte) => [parte.type, parte.value]));
  return {
    fecha: `${valor.year}-${valor.month}-${valor.day}`,
    timestamp: `${valor.year}-${valor.month}-${valor.day} ${valor.hour}:${valor.minute}:${valor.second}`,
  };
}

function agregarFaltante(faltantes, faltante) {
  faltantes.push(faltante);
}

/** Calcula, agrupa y coteja contra el stock actual los insumos de las líneas de una orden. */
export async function calcularRequeridosProduccion(client, lineasOrden, { bloquearInsumos = false } = {}) {
  const recetas = [];
  const faltantes = [];

  for (const linea of lineasOrden) {
    if (linea.id_insumo != null) {
      const { rows } = await client.query(
        `SELECT i.id_insumo, i.nombre, i.tipo, i.unidad_medida, i.stock_actual, i.estado,
                ft.id_ft, ft.cantidad, ft.medida, ft.porciones,
                ft.tiempo_preparacion, ft.pasos
           FROM tb_insumo i
           LEFT JOIN LATERAL (
             SELECT f.id_ft, f.cantidad, f.medida, f.porciones,
                    f.tiempo_preparacion, f.pasos
               FROM tb_ficha_tecnica f
              WHERE f.id_insumo = i.id_insumo
                AND (($2::integer IS NULL AND f.fecha_final IS NULL) OR f.id_ft = $2)
              ORDER BY f.version DESC
              LIMIT 1
           ) ft ON TRUE
          WHERE i.id_insumo = $1`,
        [linea.id_insumo, linea.id_ft ?? null]
      );
      const propietario = rows[0];
      if (!propietario || propietario.tipo !== 'Producto insumo' || !propietario.estado) {
        agregarFaltante(faltantes, {
          id_insumo: Number(linea.id_insumo),
          nombre: propietario?.nombre || linea.nombre || `Insumo ${linea.id_insumo}`,
          requerido: null,
          stock: propietario ? Number(propietario.stock_actual || 0) : null,
          falta: null,
          unidad: propietario?.unidad_medida || linea.unidad || null,
          motivo: !propietario ? 'El producto insumo no existe' : 'El producto insumo está inactivo o no tiene ficha técnica',
        });
        continue;
      }
      if (!propietario.id_ft) {
        agregarFaltante(faltantes, {
          id_insumo: Number(propietario.id_insumo), nombre: propietario.nombre,
          requerido: null, stock: null, falta: null, unidad: propietario.unidad_medida,
          motivo: `«${propietario.nombre}» no tiene ficha técnica`,
        });
        continue;
      }
      recetas.push({
        id_detalle_op: linea.id_detalle_op ?? null,
        id_producto: null,
        id_insumo: Number(propietario.id_insumo),
        id_ft: Number(propietario.id_ft),
        nombre: propietario.nombre,
        unidad: propietario.unidad_medida,
        cantidad_estimada: Number(linea.cantidad_estimada ?? linea.cantidad),
        categoria_nombre: null,
        tamano: null,
        ficha: propietario,
      });
      continue;
    }

    if (linea.id_producto == null) continue;
    const { rows } = await client.query(
      `SELECT p.id_producto, p.nombre, p.tipo, c.nombre AS categoria_nombre,
              ft.id_ft, ft.cantidad, ft.medida, ft.porciones,
              ft.tiempo_preparacion, ft.pasos
         FROM tb_productos p
         JOIN tb_categoria_productos c ON c.id_categoria = p.id_categoria
         LEFT JOIN LATERAL (
           SELECT f.id_ft, f.cantidad, f.medida, f.porciones,
                  f.tiempo_preparacion, f.pasos
            FROM tb_ficha_tecnica f
           WHERE f.id_producto = p.id_producto
              AND (($2::integer IS NULL AND f.fecha_final IS NULL) OR f.id_ft = $2)
            ORDER BY f.version DESC
            LIMIT 1
         ) ft ON TRUE
        WHERE p.id_producto = $1`,
      [linea.id_producto, linea.id_ft ?? null]
    );
    const producto = rows[0];
    if (!producto || producto.tipo !== 'Elaborado') continue;
    const categoria = normalizarCategoria(producto.categoria_nombre);
    if (!producto.id_ft) {
      if (categoria === 'pizza' || categoria === 'lasana') {
        agregarFaltante(faltantes, {
          id_insumo: null,
          nombre: producto.nombre,
          requerido: null,
          stock: null,
          falta: null,
          unidad: null,
          motivo: `«${producto.nombre}» no tiene ficha técnica`,
        });
      }
      continue;
    }
    recetas.push({
      id_detalle_op: linea.id_detalle_op ?? null,
      id_producto: Number(producto.id_producto),
      id_insumo: null,
      id_ft: Number(producto.id_ft),
      nombre: producto.nombre,
      unidad: linea.unidad || 'und',
      cantidad_estimada: Number(linea.cantidad_estimada),
      categoria_nombre: producto.categoria_nombre,
      tamano: linea.tamano,
      ficha: producto,
    });
  }

  const idsFicha = [...new Set(recetas.map((receta) => receta.id_ft))];
  const componentesPorFicha = new Map();
  if (idsFicha.length) {
    const { rows } = await client.query(
      `SELECT ift.id_ft, ift.id_insumo, ift.cantidad, ift.medida,
              i.nombre, i.unidad_medida, i.stock_actual, i.estado
         FROM tb_insumo_ficha_tecnica ift
         LEFT JOIN tb_insumo i ON i.id_insumo = ift.id_insumo
        WHERE ift.id_ft = ANY($1::integer[])
        ORDER BY ift.id_ft, ift.id_insumo`,
      [idsFicha]
    );
    for (const row of rows) {
      const idFicha = Number(row.id_ft);
      if (!componentesPorFicha.has(idFicha)) componentesPorFicha.set(idFicha, []);
      componentesPorFicha.get(idFicha).push(row);
    }
  }

  const necesarios = new Map();
  for (const receta of recetas) {
    for (const componente of componentesPorFicha.get(receta.id_ft) || []) {
      const idInsumo = Number(componente.id_insumo);
      const nombre = componente.nombre || `Insumo ${idInsumo}`;
      if (!necesarios.has(idInsumo)) {
        necesarios.set(idInsumo, {
          id_insumo: idInsumo,
          nombre,
          requerido: 0,
          stock: componente.stock_actual == null ? null : Number(componente.stock_actual),
          unidad: componente.unidad_medida || null,
          motivo: null,
        });
      }
      const requerido = necesarios.get(idInsumo);
      if (!componente.nombre) {
        requerido.motivo = 'El insumo de la ficha no existe';
        continue;
      }
      if (!componente.estado) requerido.motivo = `El insumo «${nombre}» está inactivo`;
      let porUnidad;
      try {
        porUnidad = convertirUnidad(
          Number(componente.cantidad) / Number(receta.ficha.cantidad),
          componente.medida,
          componente.unidad_medida,
          nombre
        );
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        requerido.motivo = error.message;
        continue;
      }
      let factorTamano = 1;
      const porciones = PORCIONES_TAMANO[normalizarCategoria(receta.categoria_nombre)]?.[receta.tamano];
      if (
        porciones !== undefined &&
        Number(receta.ficha.porciones) > 0 &&
        UNIDADES_ESCALABLES.has(componente.unidad_medida)
      ) {
        factorTamano = porciones / Number(receta.ficha.porciones);
      }
      requerido.requerido += porUnidad * factorTamano * receta.cantidad_estimada;
    }
  }

  const idsInsumos = [...necesarios.keys()].sort((a, b) => a - b);
  if (idsInsumos.length) {
    const { rows } = await client.query(
      `SELECT id_insumo, nombre, unidad_medida, stock_actual, estado
         FROM tb_insumo
        WHERE id_insumo = ANY($1::integer[])
        ORDER BY id_insumo
        ${bloquearInsumos ? 'FOR UPDATE' : ''}`,
      [idsInsumos]
    );
    const porId = new Map(rows.map((row) => [Number(row.id_insumo), row]));
    for (const requerido of necesarios.values()) {
      const actual = porId.get(requerido.id_insumo);
      if (!actual) {
        requerido.motivo = 'El insumo no existe';
        requerido.stock = null;
        continue;
      }
      requerido.nombre = actual.nombre;
      requerido.unidad = actual.unidad_medida;
      requerido.stock = Number(actual.stock_actual);
      if (!actual.estado) requerido.motivo = `El insumo «${actual.nombre}» está inactivo`;
    }
  }

  const requeridos = [...necesarios.values()].map((requerido) => ({
    ...requerido,
    requerido: Number(requerido.requerido.toFixed(6)),
    falta: requerido.stock == null ? null : Number(Math.max(0, requerido.requerido - requerido.stock).toFixed(6)),
  }));
  const faltantesFinales = [...faltantes];
  for (const requerido of requeridos) {
    if (requerido.motivo || requerido.stock == null || requerido.requerido > requerido.stock) {
      faltantesFinales.push(requerido);
    }
  }

  const descripcion = recetas.map((receta) => {
    const pasos = normalizarPasos(receta.ficha.pasos);
    if (!pasos?.length) return null;
    return `${receta.nombre}: ${pasos.join('\n')}`;
  }).filter(Boolean).join('\n\n') || null;
  const tiempos = recetas.map((receta) => Number(receta.ficha.tiempo_preparacion) || 0);

  return {
    recetas,
    requeridos,
    faltantes: faltantesFinales,
    descripcion_preparacion: descripcion,
    tiempo_preparacion_min: tiempos.length ? tiempos.reduce((suma, tiempo) => suma + tiempo, 0) : null,
  };
}
