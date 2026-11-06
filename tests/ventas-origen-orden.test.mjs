import assert from 'node:assert/strict';
import test from 'node:test';
import { pool } from '../src/config/db.js';
import { crearVentaCliente, crearVentaPanel, verificarVenta } from '../src/services/ventas.service.js';
import { listarOrdenesProduccion, obtenerOrdenProduccion } from '../src/services/ordenesProduccion.service.js';

test('ventas consecutivas del panel y pedidos de tienda crean OP sin escribir venta_local', async () => {
  const ventas = new Map();
  const ordenes = [];
  const detalles = [];
  const producto = {
    id_producto: 7, id_categoria: 2, nombre: 'Pizza prueba', tipo: 'Elaborado',
    categoria_nombre: 'Pizza', categoria_activa: true, estado: 'Disponible',
    precio_venta: 1000, precio_grande: 1200, unidad_venta: 'und',
    stock: 0, stock_partes: 120,
  };
  const consulta = async (sql, params = []) => {
    const texto = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    if (['begin', 'commit', 'rollback'].includes(texto) || texto.startsWith('select pg_advisory_xact_lock')) return { rows: [] };
    if (texto.startsWith('with completadas as') || texto.startsWith('update tb_venta set estado = $1::text')) return { rows: [], rowCount: 0 };
    if (texto.startsWith("select id_orden_produccion from tb_orden_produccion where tipo = 'preparacion'")) return { rows: [] };
    if (texto.includes('as es_personal')) return { rows: [{ id_usuario: '10001', es_personal: false }] };
    if (texto.includes('as cliente_estado')) return { rows: [{ id_usuario: '10001', rol: 'Cliente', id_cliente: 5, cliente_estado: true }] };
    if (texto.startsWith('select id_cliente, estado from tb_cliente')) return { rows: [{ id_cliente: 5, estado: true }] };
    if (texto.startsWith('select p.id_producto, p.id_categoria')) return { rows: [{ ...producto }] };
    if (texto.startsWith('insert into tb_venta')) {
      const venta = {
        id_venta: ventas.size + 1, id_cliente: params[0], fecha: params[1],
        hora_recogida: params[2], monto: params[3], estado: params[4],
        fecha_estado: params[1], venta_local: params[5],
      };
      ventas.set(venta.id_venta, venta);
      return { rows: [venta] };
    }
    if (texto.startsWith('insert into tb_detalle_venta')) {
      detalles.push({ id_venta: params[0], id_producto: params[1], cantidad: params[2], tamano: params[5] });
      return { rows: [] };
    }
    if (texto.startsWith('insert into tb_pagos')) return { rows: [{ id_pago: 1 }] };
    if (texto.startsWith('select v.id_venta, v.id_cliente, v.fecha')) return { rows: [ventas.get(params[0])] };
    if (texto.startsWith('update tb_pagos')) return { rows: [] };
    if (texto.startsWith('select id_orden_produccion from tb_orden_produccion')) {
      return { rows: ordenes.filter((orden) => orden.id_venta === params[0]) };
    }
    if (texto.startsWith('select id_venta,')) {
      const venta = ventas.get(params[0]);
      return { rows: [{ id_venta: venta.id_venta, fecha_solicitada: '2026-11-06', hora_recogida: venta.hora_recogida }] };
    }
    if (texto.startsWith('select dv.id_producto, dv.cantidad, dv.tamano')) {
      return { rows: detalles.filter((detalle) => detalle.id_venta === params[0]).map((detalle) => ({ ...producto, ...detalle })) };
    }
    if (texto.startsWith('insert into tb_orden_produccion')) {
      assert.doesNotMatch(texto, /\bventa_local\b/);
      assert.equal(params.length, 5);
      assert.match(texto, /'en proceso', true, \$4::timestamp, 25, \$4::timestamp \+ interval '25 minutes', \$5::jsonb/);
      const orden = {
        id_orden_produccion: ordenes.length + 1, id_venta: params[0], tipo: 'Pedido',
        estado: 'En proceso', fecha_en_proceso: params[3], tiempo_preparacion_min: 25,
        historial: JSON.parse(params[4]), insumos_requeridos: [],
      };
      ordenes.push(orden);
      return { rows: [orden] };
    }
    if (texto.startsWith('insert into tb_detalle_orden_produccion')) return { rows: [] };
    if (texto.startsWith('update tb_productos')) {
      producto.stock_partes -= texto.includes('- $1::int') ? params[0] : params[1];
      return { rows: [{ id_producto: 7, stock: producto.stock_partes }] };
    }
    if (texto.startsWith('update tb_venta set estado')) {
      const venta = ventas.get(params[4]);
      venta.estado = params[0];
      return { rows: [venta] };
    }
    if (texto.includes('from tb_orden_produccion op')) {
      assert.match(texto, /coalesce\(v\.venta_local, false\) as es_venta_local/);
      assert.match(texto, /left join tb_venta v on v\.id_venta = op\.id_venta/);
      const seleccionadas = texto.includes('where op.id_orden_produccion = $1')
        ? ordenes.filter((orden) => orden.id_orden_produccion === params[0])
        : ordenes;
      return { rows: seleccionadas.map((orden) => ({ ...orden, es_venta_local: ventas.get(orden.id_venta).venta_local })) };
    }
    if (texto.includes('from tb_detalle_orden_produccion d')) return { rows: [] };
    throw new Error(`Consulta no esperada: ${texto}`);
  };
  const conectarOriginal = pool.connect;
  const queryOriginal = pool.query;
  pool.connect = async () => ({ query: consulta, release() {} });
  pool.query = async (sql, params) => {
    if (sql.includes('u.correo, op.estado AS estado_orden')) return { rows: [] };
    return consulta(sql, params);
  };
  try {
    const linea = { idProducto: 7, cantidad: 1, tamano: 'Mediana' };
    const cliente = { tipoDocumento: 'CC', numeroDocumento: '10001', nombre: 'Cliente prueba' };
    for (let i = 0; i < 2; i++) {
      const venta = await crearVentaPanel(cliente, { horaRecogida: null, lineas: [linea], pago: { tipo: 'Efectivo', comprobante: null } });
      assert.equal(venta.venta_local, true);
    }
    for (let i = 0; i < 2; i++) {
      const venta = await crearVentaCliente('10001', { horaRecogida: null, lineas: [linea], pago: { tipo: 'Nequi', comprobante: 'comprobante' } });
      assert.equal(venta.venta_local, false);
      const resultado = await verificarVenta(venta.id_venta, { accion: 'aceptar' });
      assert.equal(resultado.estado, 'Por entregar');
    }
    assert.equal(producto.stock_partes, 108);
    assert.equal(ordenes.length, 4);
    for (const [indice, orden] of ordenes.entries()) {
      assert.equal(orden.estado, 'En proceso');
      assert.equal(orden.tiempo_preparacion_min, 25);
      assert.match(orden.fecha_en_proceso, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      assert.equal(orden.historial[0].de, null);
      assert.equal(orden.historial[0].a, 'En proceso');
      assert.equal(orden.historial[0].fechaHora, orden.fecha_en_proceso);
      assert.equal(orden.historial[0].origen, indice < 2 ? 'venta_panel' : undefined);
    }
    const listado = await listarOrdenesProduccion({});
    assert.deepEqual(listado.map((orden) => orden.es_venta_local), [true, true, false, false]);
    for (const [indice, orden] of ordenes.entries()) {
      const detalle = await obtenerOrdenProduccion(orden.id_orden_produccion);
      assert.equal(detalle.es_venta_local, indice < 2);
    }
  } finally {
    pool.connect = conectarOriginal;
    pool.query = queryOriginal;
  }
});

test('errores 23505 de ventas registran datos de la restricción', async () => {
  const originalConectar = pool.connect;
  const originalError = console.error;
  const mensajes = [];
  pool.connect = async () => ({
    async query(sql) {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
      throw Object.assign(new Error('duplicate key'), {
        code: '23505', table: 'tb_orden_produccion', constraint: 'uq_op_venta_local', detail: 'duplicate',
      });
    },
    release() {},
  });
  console.error = (...args) => mensajes.push(args);
  try {
    await assert.rejects(
      crearVentaPanel({ numeroDocumento: '10001' }, {}),
      (error) => error.statusCode === 409 && error.message === 'Ya existe un registro con esos datos.',
    );
    assert.deepEqual(mensajes[0].slice(1), ['23505', 'tb_orden_produccion', 'uq_op_venta_local', 'duplicate']);
  } finally {
    pool.connect = originalConectar;
    console.error = originalError;
  }
});
