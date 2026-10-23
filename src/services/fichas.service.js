import AppError from '../errors/AppError.js';
import { pool, query, transaction } from '../config/db.js';
import { convertirUnidad, normalizarPasos, redondearDosDecimales } from '../utils/insumos.js';

const COLUMNAS_FICHA = `
  ft.id_ft, ft.id_producto, ft.id_insumo, ft.version, ft.fecha_inicio,
  ft.fecha_final, ft.cantidad, ft.medida, ft.porciones,
  ft.tiempo_preparacion, ft.pasos, ft.total`;

function mapearError(error) {
  if (error instanceof AppError) return error;
  if (error?.code === '23505') return new AppError('Ya existe una ficha técnica con esos datos.', 409);
  if (error?.code === '23503') return new AppError('El producto o alguno de los insumos relacionados no existe.', 400);
  if (error?.code === '23514') return new AppError('La ficha técnica no cumple las reglas de la base de datos.', 400);
  if (error?.code === '22P02') return new AppError('Los datos enviados no son válidos.', 400);
  console.error('Error de base de datos en operación de fichas técnicas:', error?.code, error?.constraint);
  console.error(error);
  return new AppError('No se pudo completar la operación de fichas técnicas.', 503);
}

function mapearFicha(row, lineas = []) {
  return {
    id_ft: Number(row.id_ft),
    id_producto: row.id_producto == null ? null : Number(row.id_producto),
    id_insumo: row.id_insumo == null ? null : Number(row.id_insumo),
    version: Number(row.version),
    fecha_inicio: row.fecha_inicio,
    fecha_final: row.fecha_final,
    vigente: row.fecha_final == null,
    cantidad: Number(row.cantidad),
    medida: row.medida,
    porciones: row.porciones == null ? null : Number(row.porciones),
    tiempo_preparacion: row.tiempo_preparacion == null ? null : Number(row.tiempo_preparacion),
    pasos: normalizarPasos(row.pasos),
    total: Number(row.total),
    insumos: lineas.map((linea) => ({
      id_insumo: Number(linea.id_insumo),
      nombre: linea.nombre,
      unidad_insumo: linea.unidad_insumo,
      cantidad: Number(linea.cantidad),
      medida: linea.medida,
    })),
  };
}

async function cargarLineas(client, idsFicha) {
  if (!idsFicha.length) return new Map();
  const { rows } = await client.query(
    `SELECT ift.id_ft, ift.id_insumo, i.nombre,
            i.unidad_medida AS unidad_insumo, ift.cantidad, ift.medida
       FROM tb_insumo_ficha_tecnica ift
       JOIN tb_insumo i ON i.id_insumo = ift.id_insumo
      WHERE ift.id_ft = ANY($1::integer[])
      ORDER BY ift.id_ft, i.nombre`,
    [idsFicha]
  );
  const porFicha = new Map();
  for (const row of rows) {
    const idFicha = Number(row.id_ft);
    if (!porFicha.has(idFicha)) porFicha.set(idFicha, []);
    porFicha.get(idFicha).push(row);
  }
  return porFicha;
}

async function mapearFichas(client, rows) {
  const lineas = await cargarLineas(client, rows.map((row) => Number(row.id_ft)));
  return rows.map((row) => mapearFicha(row, lineas.get(Number(row.id_ft)) || []));
}

export async function obtenerPropietarioFicha(datos) {
  if (datos.id_producto != null) {
    const { rows } = await query(
      `SELECT p.id_producto, p.tipo, c.nombre AS categoria_nombre
         FROM tb_productos p
         JOIN tb_categoria_productos c ON c.id_categoria = p.id_categoria
        WHERE p.id_producto = $1`,
      [datos.id_producto]
    );
    if (!rows[0]) throw new AppError('Producto no encontrado.', 404);
    return { entidad: 'producto', ...rows[0], id_producto: Number(rows[0].id_producto) };
  }
  const { rows } = await query(
    `SELECT id_insumo, tipo, unidad_medida
       FROM tb_insumo
      WHERE id_insumo = $1`,
    [datos.id_insumo]
  );
  if (!rows[0]) throw new AppError('Insumo no encontrado.', 404);
  return { entidad: 'insumo', ...rows[0], id_insumo: Number(rows[0].id_insumo) };
}

async function obtenerPropietarioBloqueado(client, datos) {
  if (datos.id_producto != null) {
    const { rows } = await client.query(
      `SELECT p.id_producto, p.tipo, c.nombre AS categoria_nombre
         FROM tb_productos p
         JOIN tb_categoria_productos c ON c.id_categoria = p.id_categoria
        WHERE p.id_producto = $1
        FOR UPDATE OF p`,
      [datos.id_producto]
    );
    if (!rows[0]) throw new AppError('Producto no encontrado.', 404);
    return { entidad: 'producto', ...rows[0], id_producto: Number(rows[0].id_producto) };
  }
  const { rows } = await client.query(
    `SELECT id_insumo, tipo, unidad_medida
       FROM tb_insumo
      WHERE id_insumo = $1
      FOR UPDATE`,
    [datos.id_insumo]
  );
  if (!rows[0]) throw new AppError('Insumo no encontrado.', 404);
  return { entidad: 'insumo', ...rows[0], id_insumo: Number(rows[0].id_insumo) };
}

export async function listarFichasPropietario(datos) {
  const columna = datos.id_producto != null ? 'id_producto' : 'id_insumo';
  const id = datos.id_producto ?? datos.id_insumo;
  const { rows } = await query(
    `SELECT ${COLUMNAS_FICHA}
       FROM tb_ficha_tecnica ft
      WHERE ft.${columna} = $1
      ORDER BY ft.version DESC, ft.fecha_inicio DESC`,
    [id]
  );
  return mapearFichas(pool, rows);
}

export async function listarFichasVigentes() {
  const { rows } = await query(
    `SELECT ${COLUMNAS_FICHA}
       FROM tb_ficha_tecnica ft
      WHERE ft.fecha_final IS NULL
      ORDER BY ft.id_producto NULLS LAST, ft.id_insumo NULLS LAST`
  );
  return mapearFichas(pool, rows);
}

function normalizarCategoria(nombre) {
  return String(nombre || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

function compararValor(a, b) {
  return Number(a) === Number(b);
}

function mismaFichaVigente(vigente, datos, lineas) {
  if (!vigente) return false;
  const mismosCampos =
    compararValor(vigente.cantidad, datos.cantidad) &&
    vigente.medida === datos.medida &&
    (vigente.porciones == null ? null : Number(vigente.porciones)) === datos.porciones &&
    (vigente.tiempo_preparacion == null ? null : Number(vigente.tiempo_preparacion)) === datos.tiempo_preparacion &&
    JSON.stringify(normalizarPasos(vigente.pasos)) === JSON.stringify(datos.pasos);
  if (!mismosCampos || vigente.insumos.length !== lineas.length) return false;
  const actuales = [...vigente.insumos].sort((a, b) => Number(a.id_insumo) - Number(b.id_insumo));
  const nuevos = [...lineas].sort((a, b) => a.id_insumo - b.id_insumo);
  return actuales.every((actual, indice) =>
    Number(actual.id_insumo) === nuevos[indice].id_insumo &&
    compararValor(actual.cantidad, nuevos[indice].cantidad) &&
    actual.medida === nuevos[indice].medida
  );
}

async function validarLineasFicha(client, datos, propietario) {
  const ids = datos.insumos.map((linea) => linea.id_insumo);
  const { rows } = await client.query(
    `SELECT id_insumo, nombre, unidad_medida, costo_unitario, estado
       FROM tb_insumo
      WHERE id_insumo = ANY($1::integer[])
      ORDER BY id_insumo`,
    [ids]
  );
  if (rows.length !== ids.length) throw new AppError('Uno o más insumos de la ficha no existen.', 400);
  const porId = new Map(rows.map((row) => [Number(row.id_insumo), row]));
  let total = 0;
  const lineas = datos.insumos.map((linea) => {
    const insumo = porId.get(linea.id_insumo);
    if (!insumo.estado) throw new AppError(`El insumo «${insumo.nombre}» está inactivo.`, 400);
    if (propietario.entidad === 'insumo' && propietario.id_insumo === linea.id_insumo) {
      throw new AppError('Un producto insumo no puede usarse a sí mismo en su ficha técnica.', 400);
    }
    const cantidad = convertirUnidad(linea.cantidad, linea.medida, insumo.unidad_medida, insumo.nombre);
    total += cantidad * Number(insumo.costo_unitario);
    return linea;
  });
  return { lineas, total: redondearDosDecimales(total) };
}

function validarPropietarioYMedidas(propietario, datos) {
  if (propietario.entidad === 'producto') {
    if (propietario.tipo !== 'Elaborado') throw new AppError('Los productos de tipo Reventa no llevan ficha técnica.', 400);
    const categoria = normalizarCategoria(propietario.categoria_nombre);
    const porcionesEsperadas = categoria === 'pizza' ? 6 : categoria === 'lasana' ? 1 : null;
    if (porcionesEsperadas === null) throw new AppError('La categoría del producto no admite ficha técnica.', 400);
    if (datos.cantidad !== 1 || datos.medida !== 'und' || datos.porciones !== porcionesEsperadas) {
      throw new AppError(`La ficha del producto debe llevar cantidad 1, medida «und» y ${porcionesEsperadas} porciones.`, 400);
    }
  } else {
    if (propietario.tipo !== 'Producto insumo') throw new AppError('Solo los productos insumo pueden tener ficha técnica propia.', 400);
    if (datos.medida !== propietario.unidad_medida) {
      throw new AppError(`La medida de la ficha debe ser la unidad del producto insumo (${propietario.unidad_medida}).`, 400);
    }
  }
}

async function obtenerFichaPorId(client, idFicha) {
  const { rows } = await client.query(`SELECT ${COLUMNAS_FICHA} FROM tb_ficha_tecnica ft WHERE ft.id_ft = $1`, [idFicha]);
  if (!rows[0]) throw new AppError('Ficha técnica no encontrada.', 404);
  const lineas = await cargarLineas(client, [Number(idFicha)]);
  return mapearFicha(rows[0], lineas.get(Number(idFicha)) || []);
}

export async function crearVersionFicha(datos) {
  try {
    return await transaction(async (client) => {
      const propietario = await obtenerPropietarioBloqueado(client, datos);
      validarPropietarioYMedidas(propietario, datos);
      const { lineas, total } = await validarLineasFicha(client, datos, propietario);
      const columna = propietario.entidad === 'producto' ? 'id_producto' : 'id_insumo';
      const idPropietario = propietario.entidad === 'producto' ? propietario.id_producto : propietario.id_insumo;
      const { rows: actuales } = await client.query(
        `SELECT ${COLUMNAS_FICHA}
           FROM tb_ficha_tecnica ft
          WHERE ft.${columna} = $1 AND ft.fecha_final IS NULL
          ORDER BY ft.version DESC
          LIMIT 1
          FOR UPDATE`,
        [idPropietario]
      );
      let vigente = null;
      if (actuales[0]) {
        const lineasActuales = await cargarLineas(client, [Number(actuales[0].id_ft)]);
        vigente = mapearFicha(actuales[0], lineasActuales.get(Number(actuales[0].id_ft)) || []);
      }
      if (mismaFichaVigente(vigente, datos, lineas)) {
        return { statusCode: 200, ficha: { ...vigente, sinCambios: true } };
      }

      const { rows: versionRows } = await client.query(
        `SELECT COALESCE(MAX(version), 0) + 1 AS version
           FROM tb_ficha_tecnica
          WHERE ${columna} = $1`,
        [idPropietario]
      );
      const version = Number(versionRows[0].version);
      if (actuales[0]) {
        await client.query('UPDATE tb_ficha_tecnica SET fecha_final = now() WHERE id_ft = $1', [actuales[0].id_ft]);
      }
      const { rows: nueva } = await client.query(
        `INSERT INTO tb_ficha_tecnica
           (id_producto, id_insumo, version, cantidad, medida, porciones,
            tiempo_preparacion, pasos, total)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id_ft`,
        [
          propietario.entidad === 'producto' ? idPropietario : null,
          propietario.entidad === 'insumo' ? idPropietario : null,
          version,
          datos.cantidad,
          datos.medida,
          datos.porciones,
          datos.tiempo_preparacion,
          datos.pasos == null ? null : JSON.stringify(datos.pasos),
          total,
        ]
      );
      const idFicha = Number(nueva[0].id_ft);
      for (const linea of lineas) {
        await client.query(
          `INSERT INTO tb_insumo_ficha_tecnica (id_ft, id_insumo, cantidad, medida)
           VALUES ($1, $2, $3, $4)`,
          [idFicha, linea.id_insumo, linea.cantidad, linea.medida]
        );
      }
      if (propietario.entidad === 'insumo') {
        await client.query(
          'UPDATE tb_insumo SET costo_unitario = $2::numeric / $3::numeric WHERE id_insumo = $1',
          [idPropietario, total, datos.cantidad]
        );
      }
      return { statusCode: 201, ficha: await obtenerFichaPorId(client, idFicha) };
    });
  } catch (error) {
    throw mapearError(error);
  }
}
