import assert from 'node:assert/strict';
import test from 'node:test';
import { pool } from '../src/config/db.js';
import { confirmarPagoVenta, crearVentaCliente, crearVentaPanel, obtenerResumenPagos, subirComprobanteCliente, verificarVenta } from '../src/services/ventas.service.js';
import { listarOrdenesProduccion, obtenerOrdenProduccion } from '../src/services/ordenesProduccion.service.js';

test('ventas consecutivas del panel y pedidos de tienda crean OP sin escribir venta_local', async () => {
  const ventas = new Map();
  const ordenes = [];
  const detalles = [];
  const pagos = [];
  const producto = {
    id_producto: 7, id_categoria: 2, nombre: 'Pizza prueba', tipo: 'Elaborado',
    categoria_nombre: 'Pizza', categoria_activa: true, estado: 'Disponible',
    precio_venta: 1000, precio_grande: 1200, unidad_venta: 'und',
    stock: 0, stock_partes: 120,
  };
  const consulta = async (sql, params = []) => {
    const texto = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    if (['begin', 'commit', 'rollback'].includes(texto) || texto.startsWith('select pg_advisory_xact_lock')) return { rows: [] };
    if (texto.endsWith('for no key update') || texto.startsWith('with completadas as') || texto.startsWith('update tb_venta set estado = $1::text')) return { rows: [], rowCount: 0 };
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
    if (texto.startsWith('insert into tb_pagos')) {
      const pago = {
        id_pago: pagos.length + 1, id_venta: params[0], tipo: params[1],
        monto_declarado: (params.length === 8 ? params[6] : params[4]) ?? null,
        monto_confirmado: params[7] ?? null, estado: params[5] ?? 'Pendiente',
      };
      pagos.push(pago);
      return { rows: [pago] };
    }
    if (texto.startsWith('select v.monto as total')) {
      const venta = ventas.get(params[0]);
      if (!venta || (params[1] !== null && params[1] !== '10001')) return { rows: [] };
      const pagosVenta = pagos.filter((pago) => pago.id_venta === venta.id_venta);
      const recibido = pagosVenta.reduce((suma, pago) => suma + (pago.monto_confirmado ?? 0), 0);
      const en_revision = pagosVenta.reduce((suma, pago) => suma + (pago.monto_confirmado === null ? pago.monto_declarado ?? 0 : 0), 0);
      return { rows: [{
        total: venta.monto, recibido, en_revision, pagos: pagosVenta,
        falta: Math.max(0, venta.monto - recibido), saldo_a_favor: Math.max(0, recibido - venta.monto),
      }] };
    }
    if (texto.startsWith('select estado from tb_venta') || texto.startsWith('select v.id_venta, v.monto, v.estado')) {
      return { rows: ventas.has(params[0]) ? [ventas.get(params[0])] : [] };
    }
    if (texto.startsWith('select v.id_venta, v.id_cliente, v.fecha')) return { rows: [ventas.get(params[0])] };
    if (texto.startsWith('select monto_confirmado, estado from tb_pagos')) {
      return { rows: pagos.filter((pago) => pago.id_venta === params[0] && pago.id_pago === params[1]) };
    }
    if (texto.startsWith('update tb_pagos set monto_confirmado')) {
      const pago = pagos.find((pago) => pago.id_venta === params[0] && pago.id_pago === params[1]);
      pago.monto_confirmado = params[2];
      pago.estado = 'Verificado';
      return { rows: [] };
    }
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
      assert.equal(params.length, 6);
      assert.equal(params[5], 25);
      assert.match(texto, /'en proceso', true, \$4::timestamp, \$6::int, \$4::timestamp \+ \$6::int \* interval '1 minute', \$5::jsonb/);
      const orden = {
        id_orden_produccion: ordenes.length + 1, id_venta: params[0], tipo: 'Pedido',
        estado: 'En proceso', fecha_en_proceso: params[3], tiempo_preparacion_min: params[5],
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
      const venta = ventas.get(params.at(-1));
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
      const venta = await crearVentaCliente('10001', { horaRecogida: null, lineas: [linea], pago: { tipo: 'Nequi', comprobante: 'comprobante', montoDeclarado: 400 } });
      assert.equal(venta.venta_local, false);
      await assert.rejects(obtenerResumenPagos(venta.id_venta, 'otro'), { statusCode: 404 });
      assert.equal((await obtenerResumenPagos(venta.id_venta, '10001')).en_revision, 400);
      await assert.rejects(verificarVenta(venta.id_venta, { accion: 'aceptar' }), { statusCode: 409 });
      const parcial = await confirmarPagoVenta(venta.id_venta, venta.pagos[0].id_pago, 400);
      assert.equal(parcial.falta, 600);
      assert.equal(parcial.en_revision, 0);
      await assert.rejects(confirmarPagoVenta(venta.id_venta, venta.pagos[0].id_pago, 400), { statusCode: 409 });
      await verificarVenta(venta.id_venta, { accion: 'monto_faltante' });
      assert.equal((await verificarVenta(venta.id_venta, { accion: 'monto_faltante' })).estado, 'En espera');
      const carga = await subirComprobanteCliente('10001', venta.id_venta, { tipo: 'Nequi', comprobante: 'segundo' });
      assert.equal(carga.estado, 'Por verificar');
      const resumen = await confirmarPagoVenta(venta.id_venta, carga.id_pago, 650);
      assert.equal(resumen.pagos.at(-1).monto_declarado, null);
      assert.equal(resumen.recibido, 1050);
      assert.equal(resumen.falta, 0);
      assert.equal(resumen.saldo_a_favor, 50);
      await assert.rejects(verificarVenta(venta.id_venta, { accion: 'monto_faltante' }), { statusCode: 409 });
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
