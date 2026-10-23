import AppError from '../errors/AppError.js';
import { pool, query, transaction } from '../config/db.js';
import { fechaHoraBogota } from '../utils/produccion.js';
import { MOTIVO_MERMA } from '../validators/productosNoConformes.validator.js';

// Productos No Conformes (tb_productos_no_conformes).
// Registros MANUALES (tipo Producto / Producto insumo) mueven stock en la misma
// transacción: un producto de Reventa baja tb_productos.stock y un insumo baja
// tb_insumo.stock_actual (los Elaborados no tienen stock propio). Si la
// cantidad supera el stock se rechaza, así al eliminar (solo Pendiente) se
// devuelve exactamente cantidad_afectada.
// Registros del SISTEMA: la merma de Orden de Producción (motivo «Merma de
// cocina» con orden enlazada) y las devoluciones «Producto malo» (tipo Venta).
// No mueven stock aquí y no se pueden eliminar.

const COLUMNAS = `
  pnc.id_producto_no_conforme, pnc.fecha_registro::text AS fecha_registro, pnc.tipo_no_conformidad,
  pnc.id_producto, pnc.id_insumo, pnc.id_orden_produccion, pnc.id_venta,
  pnc.cantidad_afectada, pnc.unidad_medida, pnc.motivo, pnc.descripcion_detallada,
  pnc.tipo_solucion, pnc.solucion_aplicada, pnc.foto_evidencia, pnc.estado, pnc.nombre,
  pnc.categoria, pnc.causa, pnc.area_proceso, pnc.proveedor, pnc.lote, pnc.responsable,
  pnc.accion_tomada, pnc.accion_correctiva, pnc.fecha_limite::text AS fecha_limite,
  pnc.responsable_accion, pnc.fecha_cierre::text AS fecha_cierre, pnc.venta_ref, pnc.orden_ref`;

function mapearError(error) {
  if (error instanceof AppError) return error;
  if (error?.code === '23503') return new AppError('El producto, insumo, venta u orden relacionada no existe.', 400);
  if (error?.code === '23514' || error?.code === '23502' || error?.code === '22P02' || error?.code === '22001') {
    return new AppError('Los datos del registro no cumplen las reglas de la base de datos.', 400);
  }
  console.error('Error de base de datos en productos no conformes:', error?.code, error?.constraint);
  console.error(error);
  return new AppError('No se pudo completar la operación de productos no conformes.', 503);
}

const numeroONull = (valor) => (valor == null ? null : Number(valor));

function mapearRegistro(row) {
  return {
    ...row,
    id_producto_no_conforme: Number(row.id_producto_no_conforme),
    id_producto: numeroONull(row.id_producto),
    id_insumo: numeroONull(row.id_insumo),
    id_orden_produccion: numeroONull(row.id_orden_produccion),
    id_venta: numeroONull(row.id_venta),
    cantidad_afectada: Number(row.cantidad_afectada),
    generado_por_sistema: esDelSistema(row),
  };
}

/** Merma de Producción o devolución: los crea el backend, no se eliminan. */
function esDelSistema(row) {
  return row.tipo_no_conformidad === 'Venta'
    || (row.motivo === MOTIVO_MERMA && row.id_orden_produccion != null);
}

async function obtenerEnConexion(client, id, { bloquear = false } = {}) {
  const { rows } = await client.query(
    `SELECT ${COLUMNAS}
       FROM tb_productos_no_conformes pnc
      WHERE pnc.id_producto_no_conforme = $1
      ${bloquear ? 'FOR UPDATE' : ''}`,
    [id]
  );
  if (!rows[0]) throw new AppError('Registro de producto no conforme no encontrado.', 404);
  return rows[0];
}

export async function listarProductosNoConformes(filtros) {
  const condiciones = [];
  const valores = [];
  if (filtros.estado) {
    valores.push(filtros.estado);
    condiciones.push(`pnc.estado = $${valores.length}`);
  }
  if (filtros.tipo) {
    valores.push(filtros.tipo);
    condiciones.push(`pnc.tipo_no_conformidad = $${valores.length}`);
  }
  try {
    const { rows } = await query(
      `SELECT ${COLUMNAS}
         FROM tb_productos_no_conformes pnc
        ${condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : ''}
        ORDER BY pnc.fecha_registro DESC, pnc.id_producto_no_conforme DESC`,
      valores
    );
    return rows.map(mapearRegistro);
  } catch (error) {
    throw mapearError(error);
  }
}

export async function obtenerProductoNoConforme(id) {
  try {
    return mapearRegistro(await obtenerEnConexion(pool, id));
  } catch (error) {
    throw mapearError(error);
  }
}

/** Catálogo del registro manual: nombre, unidad y categoría salen de la base
 *  (no del cliente) y, si corresponde, se descuenta el stock. */
async function descontarStockManual(client, datos) {
  if (datos.tipo_no_conformidad === 'Producto') {
    const { rows } = await client.query(
      `SELECT p.id_producto, p.nombre, p.tipo, p.stock, p.unidad_venta, c.nombre AS categoria
         FROM tb_productos p
         JOIN tb_categoria_productos c ON c.id_categoria = p.id_categoria
        WHERE p.id_producto = $1
        FOR UPDATE OF p`,
      [datos.id_producto]
    );
    const producto = rows[0];
    if (!producto) throw new AppError('El producto no existe.', 400);
    if (producto.tipo === 'Reventa') {
      if (!Number.isInteger(datos.cantidad_afectada)) {
        throw new AppError('La cantidad de un producto de reventa debe ser un número entero.', 400);
      }
      if (datos.cantidad_afectada > Number(producto.stock)) {
        throw new AppError(`La cantidad supera el stock actual (${Number(producto.stock)} ${producto.unidad_venta}).`, 409);
      }
      await client.query(
        'UPDATE tb_productos SET stock = GREATEST(0, stock - $2) WHERE id_producto = $1',
        [producto.id_producto, datos.cantidad_afectada]
      );
    }
    return { nombre: producto.nombre, unidad: producto.unidad_venta, categoria: producto.categoria };
  }

  const { rows } = await client.query(
    `SELECT id_insumo, nombre, tipo, stock_actual, unidad_medida
       FROM tb_insumo
      WHERE id_insumo = $1
      FOR UPDATE`,
    [datos.id_insumo]
  );
  const insumo = rows[0];
  if (!insumo) throw new AppError('El insumo no existe.', 400);
  if (datos.cantidad_afectada > Number(insumo.stock_actual)) {
    throw new AppError(`La cantidad supera el stock actual (${Number(insumo.stock_actual)} ${insumo.unidad_medida}).`, 409);
  }
  await client.query(
    'UPDATE tb_insumo SET stock_actual = GREATEST(0, stock_actual - $2) WHERE id_insumo = $1',
    [insumo.id_insumo, datos.cantidad_afectada]
  );
  return { nombre: insumo.nombre, unidad: insumo.unidad_medida, categoria: insumo.tipo };
}

export async function crearProductoNoConforme(datos) {
  try {
    return await transaction(async (client) => {
      const catalogo = await descontarStockManual(client, datos);
      const { rows } = await client.query(
        `INSERT INTO tb_productos_no_conformes
           (fecha_registro, tipo_no_conformidad, id_producto, id_insumo, id_orden_produccion, id_venta,
            cantidad_afectada, unidad_medida, motivo, descripcion_detallada, tipo_solucion,
            solucion_aplicada, foto_evidencia, estado, nombre, categoria, causa, area_proceso,
            proveedor, lote, responsable, accion_tomada, accion_correctiva, fecha_limite,
            responsable_accion, venta_ref, orden_ref)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'Pendiente', $14, $15,
                 $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
         RETURNING id_producto_no_conforme`,
        [
          datos.fecha_registro, datos.tipo_no_conformidad, datos.id_producto, datos.id_insumo,
          datos.id_orden_produccion, datos.id_venta, datos.cantidad_afectada, catalogo.unidad,
          datos.motivo, datos.descripcion_detallada, datos.tipo_solucion, datos.solucion_aplicada,
          datos.foto_evidencia, catalogo.nombre.slice(0, 200),
          datos.categoria ?? catalogo.categoria, datos.causa, datos.area_proceso, datos.proveedor,
          datos.lote, datos.responsable, datos.accion_tomada, datos.accion_correctiva,
          datos.fecha_limite, datos.responsable_accion,
          datos.id_venta == null ? null : String(datos.id_venta),
          datos.id_orden_produccion == null ? null : String(datos.id_orden_produccion),
        ]
      );
      return mapearRegistro(await obtenerEnConexion(client, rows[0].id_producto_no_conforme));
    });
  } catch (error) {
    throw mapearError(error);
  }
}

export async function actualizarProductoNoConforme(id, datos) {
  try {
    return await transaction(async (client) => {
      const actual = await obtenerEnConexion(client, id, { bloquear: true });
      if (actual.estado !== 'Pendiente') throw new AppError('Solo se pueden editar registros Pendientes.', 409);
      if (datos.tipo_solucion === 'Reembolso' && actual.id_venta == null) {
        throw new AppError('El reembolso solo aplica cuando hay una venta relacionada.', 400);
      }
      const campos = Object.keys(datos);
      if (campos.length) {
        const asignaciones = campos.map((campo, indice) => `${campo} = $${indice + 2}`).join(', ');
        await client.query(
          `UPDATE tb_productos_no_conformes SET ${asignaciones} WHERE id_producto_no_conforme = $1`,
          [id, ...campos.map((campo) => datos[campo])]
        );
      }
      return mapearRegistro(await obtenerEnConexion(client, id));
    });
  } catch (error) {
    throw mapearError(error);
  }
}

/** Pendiente → Completado con su solución; la fecha de cierre es hoy en Bogotá. */
export async function completarProductoNoConforme(id, datos) {
  try {
    return await transaction(async (client) => {
      const actual = await obtenerEnConexion(client, id, { bloquear: true });
      if (actual.estado !== 'Pendiente') throw new AppError('El registro ya está Completado.', 409);
      if (datos.tipo_solucion === 'Reembolso' && actual.id_venta == null) {
        throw new AppError('El reembolso solo aplica cuando hay una venta relacionada.', 400);
      }
      await client.query(
        `UPDATE tb_productos_no_conformes
            SET estado = 'Completado', tipo_solucion = $2, solucion_aplicada = $3, fecha_cierre = $4
          WHERE id_producto_no_conforme = $1`,
        [id, datos.tipo_solucion, datos.solucion_aplicada, fechaHoraBogota().fecha]
      );
      return mapearRegistro(await obtenerEnConexion(client, id));
    });
  } catch (error) {
    throw mapearError(error);
  }
}

/** Solo Pendientes manuales; devuelve el stock que se descontó al crearlo. */
export async function eliminarProductoNoConforme(id) {
  try {
    return await transaction(async (client) => {
      const actual = await obtenerEnConexion(client, id, { bloquear: true });
      if (actual.estado !== 'Pendiente') throw new AppError('Solo se pueden eliminar registros Pendientes.', 409);
      if (esDelSistema(actual)) {
        throw new AppError('Este registro lo generó el sistema (merma de producción o devolución): no se puede eliminar.', 409);
      }
      const cantidad = Number(actual.cantidad_afectada);
      if (actual.tipo_no_conformidad === 'Producto' && actual.id_producto != null) {
        await client.query(
          `UPDATE tb_productos SET stock = stock + ROUND($2::numeric)::int
            WHERE id_producto = $1 AND tipo = 'Reventa'`,
          [actual.id_producto, cantidad]
        );
      } else if (actual.tipo_no_conformidad === 'Producto insumo' && actual.id_insumo != null) {
        await client.query(
          'UPDATE tb_insumo SET stock_actual = stock_actual + $2 WHERE id_insumo = $1',
          [actual.id_insumo, cantidad]
        );
      }
      await client.query('DELETE FROM tb_productos_no_conformes WHERE id_producto_no_conforme = $1', [id]);
      return { mensaje: 'Registro eliminado.' };
    });
  } catch (error) {
    throw mapearError(error);
  }
}
