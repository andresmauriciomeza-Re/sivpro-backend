import AppError from '../errors/AppError.js';

/**
 * Registra la orden Pedido y aplica los efectos de inventario asociados a la
 * aprobación de una venta. Recibe el cliente transaccional del llamador: no
 * abre ni confirma su propia transacción.
 */
export async function crearOrdenProduccion(client, idVenta) {
  const { rows: existentes } = await client.query(
    `SELECT id_orden_produccion FROM tb_orden_produccion
      WHERE id_venta = $1 AND tipo = 'Pedido'
      ORDER BY id_orden_produccion LIMIT 1 FOR UPDATE`,
    [idVenta]
  );
  if (existentes[0]) return Number(existentes[0].id_orden_produccion);

  const { rows: ventas } = await client.query(
    `SELECT id_venta, fecha::date AS fecha_solicitada, hora_recogida
       FROM tb_venta WHERE id_venta = $1`,
    [idVenta]
  );
  const venta = ventas[0];
  if (!venta?.hora_recogida) throw new AppError('La venta no tiene hora de recogida.', 409);
  const { rows: ordenRows } = await client.query(
    `INSERT INTO tb_orden_produccion (tipo, id_venta, fecha_solicitada, hora_solicitada, estado)
     VALUES ('Pedido', $1, $2, $3, 'Pendiente')
     RETURNING id_orden_produccion`,
    [idVenta, venta.fecha_solicitada, venta.hora_recogida]
  );
  const idOrden = ordenRows[0].id_orden_produccion;
  const { rows: lineas } = await client.query(
    `SELECT dv.id_producto, dv.cantidad, dv.tamano,
            p.tipo, p.unidad_venta, p.nombre
       FROM tb_detalle_venta dv
       JOIN tb_productos p ON p.id_producto = dv.id_producto
      WHERE dv.id_venta = $1
      ORDER BY dv.id_detalle_venta
      FOR UPDATE OF p`,
    [idVenta]
  );
  for (const linea of lineas) {
    if (linea.tipo === 'Elaborado') {
      await client.query(
        `INSERT INTO tb_detalle_orden_produccion
           (id_orden_produccion, id_producto, id_insumo, cantidad_estimada, unidad, nombre, tamano)
         VALUES ($1, $2, NULL, $3, $4, $5, $6)`,
        [idOrden, linea.id_producto, linea.cantidad, linea.unidad_venta, linea.nombre, linea.tamano]
      );
    } else if (linea.tipo === 'Reventa') {
      const { rows: stockRows } = await client.query(
        `UPDATE tb_productos SET stock = stock - $1
          WHERE id_producto = $2 AND tipo = 'Reventa' AND stock >= $1
          RETURNING id_producto, stock`,
        [linea.cantidad, linea.id_producto]
      );
      if (!stockRows[0]) {
        throw new AppError(`Stock insuficiente para ${linea.nombre}; no se puede pasar la venta a Por entregar.`, 409);
      }
    } else {
      throw new AppError(`Tipo de producto no soportado en producción: ${linea.tipo}.`, 409);
    }
  }
  return Number(idOrden);
}
