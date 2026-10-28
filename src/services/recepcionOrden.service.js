import AppError from '../errors/AppError.js';
import { convertirCantidadCompra } from '../utils/compras.js';
import { fechaHoraBogota } from '../utils/produccion.js';

function claveItem(item) {
  if (item.id_insumo != null) return `i:${item.id_insumo}`;
  if (item.id_producto != null) return `p:${item.id_producto}`;
  return `n:${item.nombre}`;
}

export async function recalcularRecepcionEnTransaccion(client, idOrdenCompra, { bloquear = false } = {}) {
  const clausulaBloqueo = bloquear ? 'FOR UPDATE' : '';
  const { rows: ordenes } = await client.query(
    `SELECT id_dorcompra, id_insumo, id_producto, cantidad, medida, nombre
       FROM tb_detalleordencompra
      WHERE id_ocompra = $1
      ORDER BY id_dorcompra
      ${clausulaBloqueo}`,
    [idOrdenCompra]
  );
  const { rows: compras } = await client.query(
    `SELECT id_compra FROM tb_compras
      WHERE id_ocompra = $1 AND estado = 'Recibido'
      ORDER BY id_compra
      ${clausulaBloqueo}`,
    [idOrdenCompra]
  );
  const idCompras = compras.map((compra) => Number(compra.id_compra));
  const { rows: detalles } = idCompras.length
    ? await client.query(
      `SELECT id_compra, id_insumo, id_producto, cantidad, medida,
              es_no_solicitado, nombre
         FROM tb_detallecompra
        WHERE id_compra = ANY($1::integer[])
        ORDER BY id_dcompra`,
      [idCompras]
    )
    : { rows: [] };

  const recibidosPorItem = new Map();
  const extrasPorItem = new Map();
  for (const detalle of detalles) {
    const idInsumo = detalle.id_insumo == null ? null : Number(detalle.id_insumo);
    const idProducto = detalle.id_producto == null ? null : Number(detalle.id_producto);
    const key = claveItem({ id_insumo: idInsumo, id_producto: idProducto, nombre: detalle.nombre });
    if (detalle.es_no_solicitado) {
      const extraKey = `${key}:${detalle.medida}`;
      if (!extrasPorItem.has(extraKey)) {
        extrasPorItem.set(extraKey, {
          id_insumo: idInsumo,
          id_producto: idProducto,
          nombre: detalle.nombre,
          recibida: 0,
          unidad: detalle.medida,
        });
      }
      extrasPorItem.get(extraKey).recibida += Number(detalle.cantidad);
      continue;
    }
    if (!recibidosPorItem.has(key)) recibidosPorItem.set(key, []);
    recibidosPorItem.get(key).push(detalle);
  }

  const items = ordenes.map((orden) => {
    const idInsumo = orden.id_insumo == null ? null : Number(orden.id_insumo);
    const idProducto = orden.id_producto == null ? null : Number(orden.id_producto);
    const solicitado = Number(orden.cantidad);
    const listaRecibidos = recibidosPorItem.get(claveItem({ id_insumo: idInsumo, id_producto: idProducto })) || [];
    const facturado = listaRecibidos.length > 0;
    let recibida = 0;
    for (const detalle of listaRecibidos) {
      try {
        recibida += convertirCantidadCompra(detalle.cantidad, detalle.medida, orden.medida, detalle.nombre || orden.nombre);
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError('No se pudo convertir la unidad recibida para la orden.', 400);
      }
    }
    const pendiente = facturado ? 0 : solicitado;
    return {
      id_insumo: idInsumo,
      id_producto: idProducto,
      nombre: orden.nombre,
      solicitada: solicitado,
      recibida: Number(recibida.toFixed(6)),
      pendiente: Number(pendiente.toFixed(6)),
      facturado,
      unidad: orden.medida,
    };
  });
  const extras = [...extrasPorItem.values()].map((extra) => ({
    ...extra,
    recibida: Number(extra.recibida.toFixed(6)),
  }));
  const recepcion = {
    items,
    extras,
    compras: idCompras,
    actualizado: fechaHoraBogota().timestamp,
  };
  await client.query(
    `INSERT INTO tb_recepcion_orden (id_ocompra, recepcion)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (id_ocompra) DO UPDATE SET recepcion = EXCLUDED.recepcion`,
    [idOrdenCompra, JSON.stringify(recepcion)]
  );
  return { recepcion, completado: items.length > 0 && items.every((item) => item.facturado) };
}
