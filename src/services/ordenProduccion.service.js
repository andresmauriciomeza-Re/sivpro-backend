import AppError from '../errors/AppError.js';
import normalizarCategoria from '../utils/normalizarCategoria.js';
import { fechaHoraBogota } from '../utils/produccion.js';
import { MINUTOS_CALENTAMIENTO_PEDIDO } from '../config/produccion.js';
import { partesPizza, errorStockPizza } from '../utils/stockPizza.js';

/**
 * Registra la orden Pedido y aplica los efectos de inventario asociados a la
 * aprobación de una venta. Recibe el cliente transaccional del llamador: no
 * abre ni confirma su propia transacción.
 *
 * Las pizzas descuentan porciones del stock de su tamaño y lasañas descuentan
 * unidades de stock: al aceptar la venta salen del inventario (una sola vez,
 * gracias a `productos_descontados`) y la orden inicia el CALENTAMIENTO.
 * Si no alcanza el stock, se rechaza
 * con 409 y el detalle de `faltantes` sin tocar nada: el rollback lo hace la
 * transacción de la venta. En ventas del panel el inventario ya fue descontado.
 */
export async function crearOrdenProduccion(client, idVenta, { inventarioYaDescontado = false } = {}) {
  const { rows: existentes } = await client.query(
    `SELECT id_orden_produccion FROM tb_orden_produccion
      WHERE id_venta = $1 AND tipo = 'Pedido'
      ORDER BY id_orden_produccion LIMIT 1 FOR UPDATE`,
    [idVenta]
  );
  // Idempotencia: si la orden ya existe, la venta ya descontó su stock.
  if (existentes[0]) return Number(existentes[0].id_orden_produccion);

  const { rows: ventas } = await client.query(
    `SELECT id_venta,
            (fecha::date + CASE WHEN hora_recogida < fecha::time THEN interval '1 day' ELSE interval '0' END)::date AS fecha_solicitada,
            hora_recogida
       FROM tb_venta WHERE id_venta = $1`,
    [idVenta]
  );
  const venta = ventas[0];
  if (!venta?.hora_recogida) throw new AppError('La venta no tiene hora de recogida.', 409);

  // Bloquea los productos que se van a mover para serializar aceptaciones
  // concurrentes que compitan por las mismas pre-hechas.
  const { rows: lineas } = await client.query(
    `SELECT dv.id_producto, dv.cantidad, dv.tamano,
            p.tipo, p.unidad_venta, p.nombre, p.stock,
            p.stock_partes, c.nombre AS categoria_nombre
       FROM tb_detalle_venta dv
       JOIN tb_productos p ON p.id_producto = dv.id_producto
       JOIN tb_categoria_productos c ON c.id_categoria = p.id_categoria
      WHERE dv.id_venta = $1
      ORDER BY dv.id_detalle_venta
      FOR UPDATE OF p`,
    [idVenta]
  );

  // ── 1. Validación de stock: una venta puede tener varias líneas del mismo
  //        producto (tamaños distintos), así que se agrega antes de comparar. ──
  const requeridos = new Map();
  for (const linea of lineas) {
    if (linea.tipo === 'Elaborado') {
      const idProducto = Number(linea.id_producto);
      const esPizza = normalizarCategoria(linea.categoria_nombre) === 'pizza';
      const tamano = esPizza ? linea.tamano : null;
      if (esPizza && !['Mediana', 'Grande'].includes(tamano)) {
        throw new AppError(`Selecciona Mediana o Grande para ${linea.nombre}.`, 400);
      }
      const clave = String(idProducto);
      const stock = esPizza
        ? Number(linea.stock_partes ?? 0)
        : Number(linea.stock ?? 0);
      const actual = requeridos.get(clave) ?? {
        id_producto: idProducto,
        nombre: linea.nombre,
        tamano,
        esPizza,
        unidad: esPizza ? 'porciones' : linea.unidad_venta || 'und',
        requerido: 0,
        stock,
      };
      actual.requerido += esPizza ? partesPizza(Number(linea.cantidad), tamano) : Number(linea.cantidad);
      requeridos.set(clave, actual);
    } else if (linea.tipo !== 'Reventa') {
      throw new AppError(`Tipo de producto no soportado en producción: ${linea.tipo}.`, 409);
    }
  }
  const faltantes = [];
  for (const requerido of inventarioYaDescontado ? [] : requeridos.values()) {
    if (requerido.requerido > requerido.stock) {
      if (requerido.esPizza) throw errorStockPizza(requerido.nombre, requerido.stock);
      faltantes.push({
        id_insumo: null,
        id_producto: requerido.id_producto,
        nombre: requerido.nombre,
        requerido: requerido.requerido,
        stock: requerido.stock,
        falta: requerido.requerido - requerido.stock,
        unidad: requerido.unidad,
        motivo: null,
      });
    }
  }
  if (faltantes.length) {
    const error = new AppError('No hay stock suficiente de productos elaborados (pre-hechas) para aceptar la venta.', 409);
    error.faltantes = faltantes;
    throw error;
  }

  // ── 2. La orden nace marcada: sus productos ya quedaron descontados. ──
  const inicio = fechaHoraBogota().timestamp;
  const historial = [{
    de: null, a: 'En proceso', fechaHora: inicio,
    ...(inventarioYaDescontado ? { origen: 'venta_panel' } : {}),
  }];
  const { rows: ordenRows } = await client.query(
    `INSERT INTO tb_orden_produccion
       (tipo, id_venta, fecha_solicitada, hora_solicitada, estado, productos_descontados,
        fecha_en_proceso, tiempo_preparacion_min, fecha_entrega_estimada, historial)
     VALUES ('Pedido', $1::int, $2::date, $3::time, 'En proceso', TRUE,
             $4::timestamp, ${MINUTOS_CALENTAMIENTO_PEDIDO}, $4::timestamp + interval '${MINUTOS_CALENTAMIENTO_PEDIDO} minutes', $5::jsonb)
     RETURNING id_orden_produccion`,
    [idVenta, venta.fecha_solicitada, venta.hora_recogida, inicio, JSON.stringify(historial)]
  );
  const idOrden = Number(ordenRows[0].id_orden_produccion);

  // ── 3. Detalle de la orden + descuento del stock. ──
  for (const linea of lineas) {
    if (linea.tipo === 'Elaborado') {
      const esPizza = normalizarCategoria(linea.categoria_nombre) === 'pizza';
      await client.query(
        `INSERT INTO tb_detalle_orden_produccion
           (id_orden_produccion, id_producto, id_insumo, cantidad_estimada, unidad, nombre, tamano)
         VALUES ($1, $2, NULL, $3, $4, $5, $6)`,
        [
          idOrden,
          linea.id_producto,
          linea.cantidad,
          esPizza ? 'porciones' : linea.unidad_venta,
          linea.nombre,
          linea.tamano,
        ]
      );
      if (inventarioYaDescontado) continue;
      const { rows: descontado } = await client.query(
        `UPDATE tb_productos
            SET ${esPizza ? 'stock_partes = stock_partes - $2::int' : 'stock = stock - $2::int'}
          WHERE id_producto = $1 AND tipo = 'Elaborado'
           AND ${esPizza ? 'stock_partes >= $2::int' : 'stock >= $2::int'}
          RETURNING stock`,
        [linea.id_producto, esPizza ? partesPizza(Number(linea.cantidad), linea.tamano) : linea.cantidad]
      );
      if (!descontado[0]) {
        if (esPizza) throw errorStockPizza(linea.nombre, linea.stock_partes);
        const stock = Number(linea.stock ?? 0);
        const error = new AppError('No hay stock suficiente de productos elaborados (pre-hechas) para aceptar la venta.', 409);
        error.faltantes = [{
          id_insumo: null,
          id_producto: Number(linea.id_producto),
          nombre: linea.nombre,
          requerido: Number(linea.cantidad),
          stock,
          falta: Number(linea.cantidad) - stock,
          unidad: esPizza ? 'porciones' : linea.unidad_venta || 'und',
          motivo: null,
        }];
        throw error;
      }
    } else if (linea.tipo === 'Reventa') {
      if (inventarioYaDescontado) continue;
      const { rows: stockRows } = await client.query(
        `UPDATE tb_productos SET stock = stock - $1
          WHERE id_producto = $2 AND tipo = 'Reventa' AND stock >= $1
          RETURNING id_producto, stock`,
        [linea.cantidad, linea.id_producto]
      );
      if (!stockRows[0]) {
        throw new AppError(`Stock insuficiente para ${linea.nombre}; no se puede pasar la venta a Por entregar.`, 409);
      }
    }
  }
  return idOrden;
}

/**
 * Cancela la orden "Pedido" de una venta (anulación del panel o cancelación
 * del cliente) y devuelve al stock lo que esa orden descontó al crearse en
 * `crearOrdenProduccion`:
 *
 *  - las BEBIDAS (tipo Reventa) vuelven siempre, como hasta ahora;
 *  - los ELABORADOS (pizzas/lasañas pre-hechas) sólo vuelven si la orden está
 *    marcada con `productos_descontados`: las ventas antiguas nunca les
 *    descontaron stock, acreditarle unidades sería inventar inventario.
 *
 * Recibe el cliente transaccional del llamador. Si la venta no tenía orden, o
 * su orden ya estaba cancelada, no hace nada (idempotente) y devuelve el id o
 * `null`. El UPDATE respeta `ck_op_fechas`: al pasar a 'Cancelada' se escribe
 * `fecha_cancelada` en el MISMO statement.
 */
export async function cancelarOrdenProduccionDeVenta(client, idVenta, { devolverStock = true, preservarCompletada = false } = {}) {
  const { rows } = await client.query(
    `SELECT id_orden_produccion, estado, productos_descontados, historial FROM tb_orden_produccion
      WHERE id_venta = $1 AND tipo = 'Pedido'
      ORDER BY id_orden_produccion LIMIT 1 FOR UPDATE`,
    [idVenta]
  );
  const orden = rows[0];
  if (!orden) return null;
  if (orden.estado === 'Cancelada') return Number(orden.id_orden_produccion);
  if (preservarCompletada && orden.estado === 'Completada') return null;

  const { rows: productos } = devolverStock ? await client.query(
    `SELECT dv.id_producto, dv.cantidad, dv.tamano, p.tipo,
            c.nombre AS categoria_nombre
       FROM tb_detalle_venta dv
       JOIN tb_productos p ON p.id_producto = dv.id_producto
       JOIN tb_categoria_productos c ON c.id_categoria = p.id_categoria
      WHERE dv.id_venta = $1 AND p.tipo IN ('Reventa', 'Elaborado')
      ORDER BY dv.id_detalle_venta
      FOR UPDATE OF p`,
    [idVenta]
  ) : { rows: [] };
  for (const producto of productos) {
    if (producto.tipo === 'Elaborado') {
      if (!orden.productos_descontados) continue;
      if (normalizarCategoria(producto.categoria_nombre) === 'pizza') {
        if (!['Mediana', 'Grande'].includes(producto.tamano)) {
          throw new AppError('No se puede devolver el stock de una pizza sin tamaño válido.', 409);
        }
        await client.query(
          `UPDATE tb_productos SET stock_partes = stock_partes + $1::int
            WHERE id_producto = $2 AND tipo = 'Elaborado'`,
          [partesPizza(Number(producto.cantidad), producto.tamano), producto.id_producto]
        );
      } else {
        await client.query(
          `UPDATE tb_productos SET stock = stock + $1
            WHERE id_producto = $2 AND tipo = $3`,
          [producto.cantidad, producto.id_producto, producto.tipo]
        );
      }
    } else {
      await client.query(
        `UPDATE tb_productos SET stock = stock + $1
          WHERE id_producto = $2 AND tipo = $3`,
        [producto.cantidad, producto.id_producto, producto.tipo]
      );
    }
  }

  if (!devolverStock) {
    const historial = Array.isArray(orden.historial) ? orden.historial : [];
    historial.push({
      de: orden.estado, a: 'Cancelada', fechaHora: fechaHoraBogota().timestamp,
      detalle: 'Venta anulada desde el panel.',
    });
    await client.query(
      `UPDATE tb_orden_produccion
          SET estado = 'Cancelada', fecha_cancelada = now() AT TIME ZONE 'America/Bogota',
              historial = $2::jsonb
        WHERE id_orden_produccion = $1::int`,
      [orden.id_orden_produccion, JSON.stringify(historial)]
    );
  } else {
    await client.query(
      `UPDATE tb_orden_produccion
          SET estado = 'Cancelada', fecha_cancelada = now() AT TIME ZONE 'America/Bogota'
        WHERE id_orden_produccion = $1`,
      [orden.id_orden_produccion]
    );
  }
  return Number(orden.id_orden_produccion);
}
