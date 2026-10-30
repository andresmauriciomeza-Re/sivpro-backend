/**
 * Pruebas de flujo: PIZZAS / LASAÑAS PRE-HECHAS.
 *
 * Ejecuta contra la base de `.env` (la de desarrollo) las 4 reglas del cambio:
 *
 *   1) Producto 'Elaborado' con cantidad inicial 10 → orden 'Preparacion'
 *      'Pendiente' por 10; al completarla el stock del producto vale 10.
 *   2) Vender 10 y aceptar el pago → el stock baja a 0 y nace la orden
 *      'Pedido' (calentamiento) con hora_solicitada = hora de recogida y
 *      productos_descontados = true.
 *   3) Vender 10 con sólo 6 en stock → 409 con `faltantes`, nada se descuenta
 *      y no se crea ninguna orden.
 *   4) Completar la orden 'Pedido' → el stock NO cambia.
 *
 * Uso:
 *   node tests/flujo-prehechas.mjs           (borra lo que crea y repone stock)
 *   node tests/flujo-prehechas.mjs --keep    (deja todo para inspeccionarlo)
 */
import 'dotenv/config';
import AppError from '../src/errors/AppError.js';
import { pool } from '../src/config/db.js';
import { fechaHoraBogota } from '../src/utils/produccion.js';
import {
  crearOrdenProduccion as crearPreparacion,
  completarOrdenProduccion,
  iniciarOrdenProduccion,
  obtenerOrdenProduccion,
} from '../src/services/ordenesProduccion.service.js';
import { verificarVenta } from '../src/services/ventas.service.js';

const NOMBRE_PRODUCTO = 'Pizza Hawaiana';
const HORA_RECOGIDA = '19:30:00';
const MANTENER = process.argv.includes('--keep');

const creadas = {
  idProducto: null,
  idCliente: null,
  stockOriginal: null,
  estadoOriginal: null,
  ordenes: [],
  ventas: [],
};
let fallos = 0;

function ok(condicion, texto) {
  if (condicion) {
    console.log(`  [OK]     ${texto}`);
  } else {
    fallos += 1;
    console.log(`  [FALLO]  ${texto}`);
  }
}

function igual(real, esperado, texto) {
  const iguales = real === esperado || Number(real) === Number(esperado);
  if (iguales) {
    console.log(`  [OK]     ${texto}`);
  } else {
    fallos += 1;
    console.log(`  [FALLO]  ${texto} — esperado ${JSON.stringify(esperado)}, obtuve ${JSON.stringify(real)}`);
  }
}

async function stockDe(idProducto) {
  const { rows } = await pool.query('SELECT stock FROM tb_productos WHERE id_producto = $1', [idProducto]);
  return Number(rows[0].stock);
}

async function estadoDe(idProducto) {
  const { rows } = await pool.query('SELECT estado FROM tb_productos WHERE id_producto = $1', [idProducto]);
  return rows[0]?.estado;
}

async function preparar() {
  const { rows } = await pool.query('SELECT id_producto, stock, estado FROM tb_productos WHERE nombre = $1', [NOMBRE_PRODUCTO]);
  if (!rows[0]) throw new Error(`No existe el producto «${NOMBRE_PRODUCTO}» en la base.`);
  creadas.idProducto = Number(rows[0].id_producto);
  creadas.stockOriginal = Number(rows[0].stock);
  creadas.estadoOriginal = rows[0].estado;

  const { rows: clientes } = await pool.query(
    `SELECT c.id_cliente
       FROM tb_cliente c
       JOIN tb_usuarios u ON u.id_usuario = c.id_usuario
      ORDER BY c.id_cliente
      LIMIT 1`
  );
  if (!clientes[0]) throw new Error('No hay clientes con usuario en la base.');
  creadas.idCliente = Number(clientes[0].id_cliente);

  // Parte de 0 para que las cifras coincidan con las reglas del enunciado
  // (se repone el valor original en la limpieza).
  await pool.query('UPDATE tb_productos SET stock = 0 WHERE id_producto = $1', [creadas.idProducto]);
  igual(await estadoDe(creadas.idProducto), 'No disponible', 'stock 0 fuerza No disponible');
  console.log(`Producto de prueba: ${NOMBRE_PRODUCTO} (id ${creadas.idProducto}), stock inicial 0.`);
}

async function crearVenta(cantidad) {
  const momento = fechaHoraBogota().timestamp;
  const { rows } = await pool.query(
    `INSERT INTO tb_venta (id_cliente, fecha, hora_recogida, monto, estado, fecha_estado)
     VALUES ($1, $2, $3, 0, 'Por verificar', $2)
     RETURNING id_venta`,
    [creadas.idCliente, momento, HORA_RECOGIDA]
  );
  const idVenta = Number(rows[0].id_venta);
  creadas.ventas.push(idVenta);
  await pool.query(
    `INSERT INTO tb_detalle_venta (id_venta, id_producto, cantidad, precio_unitario, sub_total, tamano)
     VALUES ($1, $2, $3, 0, 0, 'Mediana')`,
    [idVenta, creadas.idProducto, cantidad]
  );
  return idVenta;
}

async function prueba1_cantidadInicial() {
  console.log('\n1) Crear producto con cantidad inicial 10');
  const orden = await crearPreparacion({
    fecha_solicitada: fechaHoraBogota().fecha,
    hora_solicitada: null,
    observacion: 'Prueba pre-hechas (se borra sola)',
    lineas: [{ id_producto: creadas.idProducto, cantidad: 10 }],
  });
  creadas.ordenes.push(orden.id_orden_produccion);

  igual(orden.tipo, 'Preparacion', 'la orden es de tipo Preparacion');
  igual(orden.estado, 'Pendiente', 'la orden nace Pendiente');
  ok(Array.isArray(orden.lineas) && orden.lineas.length === 1, 'la orden tiene una línea');
  igual(orden.lineas[0].id_producto, creadas.idProducto, 'la línea se resolvió como producto del menú (id_producto)');
  igual(orden.lineas[0].id_insumo, null, 'la línea no toca insumos');
  igual(orden.lineas[0].cantidad_estimada, 10, 'la línea pide 10 unidades');

  await iniciarOrdenProduccion(orden.id_orden_produccion);
  await completarOrdenProduccion(orden.id_orden_produccion, {
    lineas: [{ id_detalle_op: orden.lineas[0].id_detalle_op, cantidad_real: 10 }],
  });

  const stock = await stockDe(creadas.idProducto);
  igual(stock, 10, 'al completar la preparación, el stock del producto vale 10 (pre-hechas)');
}

async function prueba2_aceptarVenta() {
  console.log('\n2) Aceptar el pago de 10 unidades');
  await pool.query(
    `UPDATE tb_productos SET estado = 'Disponible' WHERE id_producto = $1`,
    [creadas.idProducto]
  );
  const idVenta = await crearVenta(10);
  const venta = await verificarVenta(idVenta, { accion: 'aceptar' });
  creadas.ordenes.push(Number(venta.id_orden_produccion));

  igual(venta.estado, 'Por entregar', 'la venta pasa a Por entregar');
  const orden = await obtenerOrdenProduccion(venta.id_orden_produccion);
  igual(orden.tipo, 'Pedido', 'se creó la orden Pedido (encargo de calentamiento)');
  igual(orden.estado, 'Pendiente', 'la orden Pedido queda Pendiente');
  igual(orden.hora_solicitada, HORA_RECOGIDA, 'hora_solicitada = hora de recogida de la venta');
  ok(orden.fecha_solicitada != null, 'fecha_solicitada viene de la fecha del pedido');
  ok(orden.productos_descontados === true, 'productos_descontados = true (descuento aplicado una sola vez)');
  igual(await stockDe(creadas.idProducto), 0, 'el stock de Hawaiana pasa a 0');
  igual(await estadoDe(creadas.idProducto), 'No disponible', 'al agotarse, el producto pasa a No disponible');
}

async function prueba3_stockInsuficiente() {
  console.log('\n3) Vender 10 cuando sólo hay 6');
  await pool.query(
    `UPDATE tb_productos SET stock = 6, estado = 'Disponible' WHERE id_producto = $1`,
    [creadas.idProducto]
  );
  const idVenta = await crearVenta(10);

  let error = null;
  try {
    await verificarVenta(idVenta, { accion: 'aceptar' });
  } catch (capturado) {
    error = capturado;
  }

  ok(error != null, 'el backend rechaza la aceptación');
  ok(error instanceof AppError, 'el error es un AppError');
  igual(error?.statusCode, 409, 'responde 409');
  ok(Array.isArray(error?.faltantes) && error.faltantes.length > 0, 'el error trae el detalle de faltantes');
  const falta = error?.faltantes?.[0];
  igual(falta?.id_producto, creadas.idProducto, 'el faltante identifica el producto');
  igual(falta?.stock, 6, 'el faltante reporta el stock actual (6)');
  igual(falta?.falta, 4, 'el faltante reporta cuánto falta (4)');
  igual(falta?.requerido, 10, 'el faltante reporta lo pedido (10)');

  igual(await stockDe(creadas.idProducto), 6, 'el stock no se movió');
  const { rows: ordenes } = await pool.query(
    "SELECT count(*) AS n FROM tb_orden_produccion WHERE id_venta = $1 AND tipo = 'Pedido'",
    [idVenta]
  );
  igual(ordenes[0].n, 0, 'no se creó ninguna orden Pedido');
  const { rows: venta } = await pool.query('SELECT estado FROM tb_venta WHERE id_venta = $1', [idVenta]);
  igual(venta[0].estado, 'Por verificar', 'la venta sigue Por verificar (transacción revertida)');
}

async function prueba4_completarPedido() {
  console.log('\n4) Completar la orden Pedido (calentamiento)');
  await pool.query('UPDATE tb_productos SET stock = 0 WHERE id_producto = $1', [creadas.idProducto]);
  const { rows } = await pool.query(
    `SELECT id_orden_produccion FROM tb_orden_produccion
      WHERE tipo = 'Pedido' AND productos_descontados = TRUE
      ORDER BY id_orden_produccion DESC
      LIMIT 1`
  );
  const orden = await obtenerOrdenProduccion(Number(rows[0].id_orden_produccion));
  const stockAntes = await stockDe(creadas.idProducto);

  await iniciarOrdenProduccion(orden.id_orden_produccion);
  const enProceso = await obtenerOrdenProduccion(orden.id_orden_produccion);
  igual(enProceso.estado, 'En proceso', 'el pedido pasa a En proceso');
  ok(enProceso.insumos_descontados === true, 'la fase de insumos queda resuelta SIN descontar nada');
  igual(enProceso.lineas.filter((linea) => linea.id_insumo != null).length, 0, 'el pedido no tiene líneas de insumo');

  await completarOrdenProduccion(orden.id_orden_produccion, { lineas: null });
  const final = await obtenerOrdenProduccion(orden.id_orden_produccion);
  igual(final.estado, 'Completada', 'la orden Pedido queda Completada');
  igual(stockAntes, 0, 'el stock estaba en 0 antes de completar');
  igual(await stockDe(creadas.idProducto), 0, 'el stock de Hawaiana NO cambió al completar (sigue en 0)');
}

async function limpiar() {
  if (MANTENER) {
    console.log('\nLimpieza omitida (--keep).');
    return;
  }
  if (creadas.ordenes.length) {
    await pool.query('DELETE FROM tb_productos_no_conformes WHERE id_orden_produccion = ANY($1::integer[])', [creadas.ordenes]);
    await pool.query('DELETE FROM tb_orden_produccion WHERE id_orden_produccion = ANY($1::integer[])', [creadas.ordenes]);
  }
  if (creadas.ventas.length) {
    await pool.query('DELETE FROM tb_pagos WHERE id_venta = ANY($1::integer[])', [creadas.ventas]);
    await pool.query('DELETE FROM tb_detalle_venta WHERE id_venta = ANY($1::integer[])', [creadas.ventas]);
    await pool.query('DELETE FROM tb_venta WHERE id_venta = ANY($1::integer[])', [creadas.ventas]);
  }
  if (creadas.idProducto != null && creadas.stockOriginal != null) {
    await pool.query(
      'UPDATE tb_productos SET stock = $2, estado = $3 WHERE id_producto = $1',
      [creadas.idProducto, creadas.stockOriginal, creadas.estadoOriginal]
    );
  }
  console.log('\nLimpieza OK: órdenes/ventas de la prueba borradas y stock original repuesto.');
}

let errorFatal = null;
try {
  console.log('── Flujo de pizzas/lasañas pre-hechas ──');
  await preparar();
  await prueba1_cantidadInicial();
  await prueba2_aceptarVenta();
  await prueba3_stockInsuficiente();
  await prueba4_completarPedido();
} catch (error) {
  errorFatal = error;
  console.error('\n[FALLO FATAL]', error);
} finally {
  try {
    await limpiar();
  } catch (error) {
    console.error('\n[LIMPIEZA] No se pudo limpiar, revisa la base a mano:', error);
  }
  await pool.end();
}

if (errorFatal || fallos) {
  console.log(`\nRESULTADO: ${fallos} aserciones fallidas${errorFatal ? ' + error fatal' : ''}.`);
  process.exit(1);
}
console.log('\nRESULTADO: todas las pruebas pasaron.');
process.exit(0);
