import AppError from '../errors/AppError.js';
import { pool, query, transaction } from '../config/db.js';
import { compararNombreInsumo, convertirUnidad, normalizarPasos, redondearDosDecimales } from '../utils/insumos.js';
import { crearPreparacionEnTransaccion } from './ordenesProduccion.service.js';
import { fechaHoraBogota } from '../utils/produccion.js';

const COLUMNAS_INSUMO = `
  i.id_insumo, i.id_categoria_insumo, i.nombre, i.tipo, i.unidad_medida,
  i.stock_actual, i.stock_minimo, i.stock_maximo, i.costo_unitario,
  i.costo_maximo, i.iva, i.descripcion, i.tiempo_preparacion, i.estado,
  c.nombre AS categoria_nombre`;

const COLUMNAS_FICHA = `
  ft.id_ft, ft.id_producto, ft.id_insumo, ft.version, ft.fecha_inicio,
  ft.fecha_final, ft.cantidad, ft.medida, ft.porciones,
  ft.tiempo_preparacion, ft.pasos, ft.total`;

function mapearError(error, { nombre, eliminando = false } = {}) {
  if (error instanceof AppError) return error;
  if (error?.code === '23505') {
    if (error?.constraint === 'tb_insumo_nombre_key') {
      return new AppError('Ya existe un insumo con ese nombre', 409);
    }
    return new AppError('Ya existe un registro con esos datos.', 409);
  }
  if (error?.code === '23503') {
    if (eliminando && nombre) return new AppError(`No se puede eliminar «${nombre}»: tiene historial. Desactívalo.`, 409);
    return new AppError('La categoría o alguno de los insumos relacionados no existe.', 400);
  }
  if (error?.code === '23514') {
    return new AppError('Los datos del insumo no cumplen las reglas de la base de datos.', 400);
  }
  if (error?.code === '22P02') return new AppError('Los datos enviados no son válidos.', 400);
  console.error('Error de base de datos en operación de insumos:', error?.code, error?.constraint);
  console.error(error);
  return new AppError('No se pudo completar la operación de insumos.', 503);
}

function numeroONull(valor) {
  return valor == null ? null : Number(valor);
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
    porciones: numeroONull(row.porciones),
    tiempo_preparacion: numeroONull(row.tiempo_preparacion),
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

async function cargarLineasFicha(client, idsFicha) {
  if (!idsFicha.length) return new Map();
  const { rows } = await client.query(
    `SELECT ift.id_ft, ift.id_insumo, i.nombre, i.unidad_medida AS unidad_insumo,
            ift.cantidad, ift.medida
       FROM tb_insumo_ficha_tecnica ift
       JOIN tb_insumo i ON i.id_insumo = ift.id_insumo
      WHERE ift.id_ft = ANY($1::integer[])
      ORDER BY ift.id_ft, i.nombre`,
    [idsFicha]
  );
  const porFicha = new Map();
  for (const row of rows) {
    if (!porFicha.has(Number(row.id_ft))) porFicha.set(Number(row.id_ft), []);
    porFicha.get(Number(row.id_ft)).push(row);
  }
  return porFicha;
}

async function cargarFichaVigenteInsumo(client, idInsumo) {
  const { rows } = await client.query(
    `SELECT ${COLUMNAS_FICHA}
       FROM tb_ficha_tecnica ft
      WHERE ft.id_insumo = $1 AND ft.fecha_final IS NULL
      ORDER BY ft.version DESC
      LIMIT 1`,
    [idInsumo]
  );
  if (!rows[0]) return null;
  const lineas = await cargarLineasFicha(client, [Number(rows[0].id_ft)]);
  return mapearFicha(rows[0], lineas.get(Number(rows[0].id_ft)) || []);
}

function mapearInsumo(row, fichaVigente) {
  const insumo = {
    id_insumo: Number(row.id_insumo),
    id_categoria_insumo: Number(row.id_categoria_insumo),
    nombre: row.nombre,
    tipo: row.tipo,
    unidad_medida: row.unidad_medida,
    stock_actual: Number(row.stock_actual),
    stock_minimo: Number(row.stock_minimo),
    stock_maximo: Number(row.stock_maximo),
    costo_unitario: Number(row.costo_unitario),
    costo_maximo: numeroONull(row.costo_maximo),
    iva: Number(row.iva),
    descripcion: row.descripcion,
    tiempo_preparacion: numeroONull(row.tiempo_preparacion),
    estado: row.estado,
    categoria_nombre: row.categoria_nombre,
  };
  if (row.tipo === 'Producto insumo') insumo.ficha_vigente = fichaVigente;
  return insumo;
}

async function validarCategoriaActiva(client, idCategoria) {
  const { rows } = await client.query(
    `SELECT id_categoria_insumo, nombre, estado
       FROM tb_categoria_insumos
      WHERE id_categoria_insumo = $1`,
    [idCategoria]
  );
  if (!rows[0] || !rows[0].estado) throw new AppError('La categoría no existe o está inactiva.', 400);
  return rows[0];
}

async function validarNombreUnico(client, nombre, idExcluir = null) {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`insumo-nombre:${compararNombreInsumo(nombre)}`]);
  const { rows } = await client.query(
    `SELECT id_insumo, nombre FROM tb_insumo
      WHERE ($1::integer IS NULL OR id_insumo <> $1)`,
    [idExcluir]
  );
  if (rows.some((row) => compararNombreInsumo(row.nombre) === compararNombreInsumo(nombre))) {
    throw new AppError('Ya existe un insumo con ese nombre', 409);
  }
}

async function cargarInsumosFicha(client, ficha, { bloquearStock = false } = {}) {
  const ids = ficha.insumos.map((linea) => linea.id_insumo);
  const { rows } = await client.query(
    `SELECT id_insumo, nombre, unidad_medida, stock_actual, costo_unitario, estado
       FROM tb_insumo
      WHERE id_insumo = ANY($1::integer[])
      ORDER BY id_insumo
      ${bloquearStock ? 'FOR UPDATE' : ''}`,
    [ids]
  );
  const porId = new Map(rows.map((row) => [Number(row.id_insumo), row]));
  if (rows.length !== ids.length) throw new AppError('Uno o más insumos de la ficha no existen.', 400);

  const faltantes = [];
  let total = 0;
  const lineas = ficha.insumos.map((linea) => {
    const insumo = porId.get(linea.id_insumo);
    if (!insumo.estado) throw new AppError(`El insumo «${insumo.nombre}» está inactivo.`, 400);
    const requerido = convertirUnidad(linea.cantidad, linea.medida, insumo.unidad_medida, insumo.nombre);
    if (bloquearStock && requerido > Number(insumo.stock_actual)) {
      faltantes.push({
        id_insumo: Number(insumo.id_insumo),
        nombre: insumo.nombre,
        requerido,
        stock: Number(insumo.stock_actual),
        unidad: insumo.unidad_medida,
      });
    }
    total += requerido * Number(insumo.costo_unitario);
    return { ...linea, requerido, unidad_insumo: insumo.unidad_medida };
  });

  if (faltantes.length) {
    const error = new AppError(
      `No hay la cantidad suficiente de insumos. Por favor, disminuye la cantidad de ${faltantes[0].nombre}.`,
      409
    );
    error.faltantes = faltantes;
    throw error;
  }
  return { lineas, total: redondearDosDecimales(total) };
}

async function insertarFichaProductoInsumo(client, idInsumo, ficha, total) {
  const { rows } = await client.query(
    `INSERT INTO tb_ficha_tecnica
       (id_insumo, version, cantidad, medida, porciones, tiempo_preparacion, pasos, total)
     VALUES ($1, 1, $2, $3, NULL, $4, $5, $6)
     RETURNING id_ft`,
    [
      idInsumo,
      ficha.cantidad,
      ficha.medida,
      ficha.tiempo_preparacion,
      ficha.pasos == null ? null : JSON.stringify(ficha.pasos),
      total,
    ]
  );
  return Number(rows[0].id_ft);
}

export async function listarCategoriasInsumo() {
  const { rows } = await query(
    `SELECT id_categoria_insumo, nombre, estado
       FROM tb_categoria_insumos
      ORDER BY nombre`
  );
  return rows.map((row) => ({ ...row, id_categoria_insumo: Number(row.id_categoria_insumo) }));
}

export async function listarInsumos(filtros) {
  const condiciones = [];
  const valores = [];
  if (filtros.tipo !== undefined) {
    valores.push(filtros.tipo);
    condiciones.push(`i.tipo = $${valores.length}`);
  }
  if (filtros.estado !== undefined) {
    valores.push(filtros.estado);
    condiciones.push(`i.estado = $${valores.length}`);
  }
  const { rows } = await query(
    `SELECT ${COLUMNAS_INSUMO}
       FROM tb_insumo i
       JOIN tb_categoria_insumos c ON c.id_categoria_insumo = i.id_categoria_insumo
      ${condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : ''}
      ORDER BY i.nombre`,
    valores
  );
  const fichasVigentes = rows.filter((row) => row.tipo === 'Producto insumo');
  const { rows: fichas } = fichasVigentes.length
    ? await query(
      `SELECT ${COLUMNAS_FICHA}
         FROM tb_ficha_tecnica ft
        WHERE ft.id_insumo = ANY($1::integer[]) AND ft.fecha_final IS NULL
        ORDER BY ft.id_insumo, ft.version DESC`,
      [fichasVigentes.map((row) => Number(row.id_insumo))]
    )
    : { rows: [] };
  const lineasPorFicha = await cargarLineasFicha(pool, fichas.map((ficha) => Number(ficha.id_ft)));
  const fichaPorInsumo = new Map();
  for (const ficha of fichas) {
    const idInsumo = Number(ficha.id_insumo);
    if (!fichaPorInsumo.has(idInsumo)) {
      fichaPorInsumo.set(idInsumo, mapearFicha(ficha, lineasPorFicha.get(Number(ficha.id_ft)) || []));
    }
  }
  return rows.map((row) => mapearInsumo(row, fichaPorInsumo.get(Number(row.id_insumo)) || null));
}

export async function obtenerInsumo(idInsumo) {
  const { rows } = await query(
    `SELECT ${COLUMNAS_INSUMO}
       FROM tb_insumo i
       JOIN tb_categoria_insumos c ON c.id_categoria_insumo = i.id_categoria_insumo
      WHERE i.id_insumo = $1`,
    [idInsumo]
  );
  if (!rows[0]) throw new AppError('Insumo no encontrado.', 404);
  const ficha = rows[0].tipo === 'Producto insumo' ? await cargarFichaVigenteInsumo(pool, idInsumo) : null;
  return mapearInsumo(rows[0], ficha);
}

export async function crearInsumo(datos) {
  try {
    return await transaction(async (client) => {
      await validarNombreUnico(client, datos.nombre);
      await validarCategoriaActiva(client, datos.id_categoria_insumo);
      let lineasPreparadas = [];
      let totalFicha = 0;
      if (datos.tipo === 'Producto insumo') {
        const validacion = await cargarInsumosFicha(client, datos.ficha, { bloquearStock: true });
        lineasPreparadas = validacion.lineas;
        totalFicha = validacion.total;
      }

      const { rows } = await client.query(
        `INSERT INTO tb_insumo
           (id_categoria_insumo, nombre, tipo, unidad_medida, stock_actual,
            stock_minimo, stock_maximo, costo_unitario, iva, descripcion,
            tiempo_preparacion, estado)
         VALUES ($1, $2, $3, $4, 0, $5, 0, $6, $7, $8, $9, TRUE)
         RETURNING id_insumo`,
        [
          datos.id_categoria_insumo,
          datos.nombre,
          datos.tipo,
          datos.unidad_medida,
          datos.stock_minimo,
          datos.tipo === 'Producto insumo' ? 0 : datos.costo_unitario,
          datos.iva,
          datos.descripcion,
          datos.tipo === 'Producto insumo' ? datos.ficha.tiempo_preparacion : null,
        ]
      );
      const idInsumo = Number(rows[0].id_insumo);
      let ordenProduccion = null;
      if (datos.tipo === 'Producto insumo') {
        const idFicha = await insertarFichaProductoInsumo(client, idInsumo, datos.ficha, totalFicha);
        for (const linea of lineasPreparadas) {
          await client.query(
            `INSERT INTO tb_insumo_ficha_tecnica (id_ft, id_insumo, cantidad, medida)
             VALUES ($1, $2, $3, $4)`,
            [idFicha, linea.id_insumo, linea.cantidad, linea.medida]
          );
        }
        await client.query(
          'UPDATE tb_insumo SET costo_unitario = $2::numeric / $3::numeric WHERE id_insumo = $1',
          [idInsumo, totalFicha, datos.ficha.cantidad]
        );
        if (datos.crear_orden_produccion) {
          ordenProduccion = await crearPreparacionEnTransaccion(
            client,
            {
              fecha_solicitada: fechaHoraBogota().fecha,
              hora_solicitada: null,
              observacion: null,
              lineas: [{ id_insumo: idInsumo, cantidad: datos.ficha.cantidad }],
            },
            'Creada desde Insumos'
          );
        }
      }
      const insumo = await obtenerInsumoEnConexion(client, idInsumo);
      if (ordenProduccion) insumo.orden_produccion = ordenProduccion;
      return insumo;
    });
  } catch (error) {
    throw mapearError(error);
  }
}

async function obtenerInsumoEnConexion(client, idInsumo) {
  const { rows } = await client.query(
    `SELECT ${COLUMNAS_INSUMO}
       FROM tb_insumo i
       JOIN tb_categoria_insumos c ON c.id_categoria_insumo = i.id_categoria_insumo
      WHERE i.id_insumo = $1`,
    [idInsumo]
  );
  const ficha = rows[0].tipo === 'Producto insumo' ? await cargarFichaVigenteInsumo(client, idInsumo) : null;
  return mapearInsumo(rows[0], ficha);
}

export async function actualizarInsumo(idInsumo, datos) {
  try {
    return await transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT id_insumo, id_categoria_insumo, nombre, tipo, unidad_medida, stock_actual
           FROM tb_insumo
          WHERE id_insumo = $1
          FOR UPDATE`,
        [idInsumo]
      );
      const actual = rows[0];
      if (!actual) throw new AppError('Insumo no encontrado.', 404);
      if (datos.tipo !== undefined && datos.tipo !== actual.tipo) {
        throw new AppError('El tipo de insumo no se puede cambiar.', 400);
      }
      if (datos.id_categoria_insumo !== undefined) await validarCategoriaActiva(client, datos.id_categoria_insumo);
      if (datos.costo_unitario !== undefined || datos.iva !== undefined) {
        if (actual.tipo !== 'Insumo') throw new AppError('Solo los insumos tipo Insumo permiten editar costo_unitario e iva.', 400);
      }
      if (datos.unidad_medida !== undefined && datos.unidad_medida !== actual.unidad_medida) {
        const { rows: usoRows } = await client.query(
          `SELECT EXISTS (
             SELECT 1 FROM tb_insumo_ficha_tecnica WHERE id_insumo = $1
             UNION ALL
             SELECT 1 FROM tb_ficha_tecnica WHERE id_insumo = $1
           ) AS en_ficha`,
          [idInsumo]
        );
        if (Number(actual.stock_actual) !== 0 || usoRows[0].en_ficha) {
          throw new AppError('No se puede cambiar la unidad: el insumo tiene stock o está en una ficha técnica', 409);
        }
      }
      if (datos.nombre !== undefined) await validarNombreUnico(client, datos.nombre, idInsumo);

      const cambios = {};
      for (const campo of ['nombre', 'id_categoria_insumo', 'unidad_medida', 'stock_minimo', 'descripcion']) {
        if (datos[campo] !== undefined) cambios[campo] = datos[campo];
      }
      if (actual.tipo === 'Insumo') {
        for (const campo of ['costo_unitario', 'iva']) {
          if (datos[campo] !== undefined) cambios[campo] = datos[campo];
        }
      }
      if (Object.keys(cambios).length) {
        const asignaciones = Object.keys(cambios).map((campo, indice) => `${campo} = $${indice + 2}`).join(', ');
        await client.query(`UPDATE tb_insumo SET ${asignaciones} WHERE id_insumo = $1`, [idInsumo, ...Object.values(cambios)]);
      }
      return await obtenerInsumoEnConexion(client, idInsumo);
    });
  } catch (error) {
    throw mapearError(error);
  }
}

export async function cambiarEstadoInsumo(idInsumo, estado) {
  try {
    return await transaction(async (client) => {
      const { rowCount } = await client.query('UPDATE tb_insumo SET estado = $2 WHERE id_insumo = $1', [idInsumo, estado]);
      if (!rowCount) throw new AppError('Insumo no encontrado.', 404);
      return await obtenerInsumoEnConexion(client, idInsumo);
    });
  } catch (error) {
    throw mapearError(error);
  }
}

export async function eliminarInsumo(idInsumo) {
  let nombre;
  try {
    return await transaction(async (client) => {
      const { rows } = await client.query(
        'SELECT id_insumo, nombre, tipo FROM tb_insumo WHERE id_insumo = $1 FOR UPDATE',
        [idInsumo]
      );
      const actual = rows[0];
      if (!actual) throw new AppError('Insumo no encontrado.', 404);
      nombre = actual.nombre;

      const { rows: fichasPropias } = await client.query(
        'SELECT EXISTS (SELECT 1 FROM tb_ficha_tecnica WHERE id_insumo = $1) AS tiene_ficha_propia',
        [idInsumo]
      );
      const referencias = [
        ['tb_insumo_ficha_tecnica', 'id_insumo'],
        ['tb_detallecompra', 'id_insumo'],
        ['tb_detalleordencompra', 'id_insumo'],
        ['tb_detalle_orden_produccion', 'id_insumo'],
        ['tb_productos_no_conformes', 'id_insumo'],
      ];
      for (const [tabla, columna] of referencias) {
        const { rows: existe } = await client.query(
          `SELECT EXISTS (SELECT 1 FROM ${tabla} WHERE ${columna} = $1) AS tiene_historial`,
          [idInsumo]
        );
        if (existe[0].tiene_historial) {
          throw new AppError(`No se puede eliminar «${nombre}»: tiene historial. Desactívalo.`, 409);
        }
      }

      if (actual.tipo === 'Producto insumo' && fichasPropias[0].tiene_ficha_propia) {
        await client.query('DELETE FROM tb_ficha_tecnica WHERE id_insumo = $1', [idInsumo]);
      }
      await client.query('DELETE FROM tb_insumo WHERE id_insumo = $1', [idInsumo]);
      return { message: 'Insumo eliminado.' };
    });
  } catch (error) {
    throw mapearError(error, { nombre, eliminando: true });
  }
}
