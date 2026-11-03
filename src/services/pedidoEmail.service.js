import { estadoClientePedido } from '../utils/estadoPedidoCliente.js';
import { query } from '../config/db.js';
import { enviarEstadoPedido } from './mail.service.js';

/** Reúne los datos del pedido para correo, usando el cliente transaccional
 * cuando se requiera o el pool tras el COMMIT para enviar sin bloquear la operación. */
export async function datosCorreoPedido(client, idVenta) {
  const { rows } = await client.query(
    `SELECT v.id_venta, v.id_cliente, v.estado, v.monto, v.hora_recogida,
            v.motivo_rechazo, v.anulado_por, v.monto_reembolso,
            u.nombre, u.correo, op.estado AS estado_orden
       FROM tb_venta v
       JOIN tb_cliente c ON c.id_cliente = v.id_cliente
       JOIN tb_usuarios u ON u.id_usuario = c.id_usuario
       LEFT JOIN LATERAL (
         SELECT o.estado
           FROM tb_orden_produccion o
          WHERE o.id_venta = v.id_venta AND o.tipo = 'Pedido'
          ORDER BY o.id_orden_produccion DESC
          LIMIT 1
       ) op ON TRUE
      WHERE v.id_venta = $1`,
    [idVenta],
  );
  const venta = rows[0];
  if (!venta) return null;

  const { rows: productos } = await client.query(
    `SELECT p.nombre, dv.tamano, dv.cantidad
       FROM tb_detalle_venta dv
       JOIN tb_productos p ON p.id_producto = dv.id_producto
      WHERE dv.id_venta = $1
      ORDER BY dv.id_detalle_venta`,
    [idVenta],
  );
  const estado = estadoClientePedido({
    estadoVenta: venta.estado,
    estadoOrden: venta.estado_orden,
    tieneOrden: venta.estado_orden != null,
    anulado_por: venta.anulado_por,
    motivo_rechazo: venta.motivo_rechazo,
  });

  return {
    correo: venta.correo,
    nombre: venta.nombre,
    id: Number(venta.id_venta),
    estado,
    productos: productos.map((producto) => ({
      nombre: producto.nombre,
      tamano: producto.tamano,
      cantidad: Number(producto.cantidad),
    })),
    total: Number(venta.monto),
    horaRecogida: venta.hora_recogida == null
      ? null
      : String(venta.hora_recogida).slice(0, 5),
    motivo: venta.motivo_rechazo,
    montoReembolso: venta.monto_reembolso == null
      ? null
      : Number(venta.monto_reembolso),
  };
}

/** Prepara el correo con datos ya confirmados y nunca deja que una consulta o
 * un fallo SMTP altere la respuesta de la operación que cambió el pedido. */
export async function notificarEstadoPedido(idVenta) {
  try {
    const datos = await datosCorreoPedido({ query }, idVenta);
    if (datos) void enviarEstadoPedido(datos);
  } catch (error) {
    console.error(
      `No se pudieron preparar los datos del correo del pedido ${idVenta}: ${error?.code || error?.message || error}`,
    );
  }
}
