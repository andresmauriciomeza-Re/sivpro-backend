import assert from 'node:assert/strict';
import test from 'node:test';
import { pool } from '../src/config/db.js';
import { completarOrdenProduccion } from '../src/services/ordenesProduccion.service.js';
import { marcarVentaLista } from '../src/services/ventas.service.js';
import ventasRouter from '../src/routes/ventas.routes.js';

test('la ruta de venta lista exige autenticación y permiso de edición', () => {
  const ruta = ventasRouter.stack.find((capa) => capa.route?.path === '/ventas/:id/listo')?.route;
  assert.equal(ruta?.methods.post, true);
  assert.equal(ruta.stack.length, 3);
  assert.equal(ruta.stack[0].handle.name, 'verificarToken');
});

async function conBase({ local = true, estadoOrden = 'En proceso', estadoVenta = 'Por entregar', productos, recogidaPasada = false } = {}, ejecutar) {
  const venta = { id_venta: 31, estado: estadoVenta, venta_local: local };
  const orden = estadoOrden == null ? null : {
    id_orden_produccion: 99, id_venta: 31, tipo: 'Pedido', estado: estadoOrden,
    fecha_solicitada: '2026-11-05', historial: [], insumos_requeridos: [], es_venta_local: local,
  };
  const lineas = [
    { id_detalle_op: 1, id_producto: 7, nombre: 'Pizza', cantidad_estimada: 3, cantidad_real: null, unidad: 'porciones' },
    { id_detalle_op: 2, id_producto: 8, nombre: 'Lasaña', cantidad_estimada: 2, cantidad_real: null, unidad: 'und' },
  ];
  const consultas = [];
  let notificaciones = 0;
  const client = {
    async query(sql, params = []) {
      const texto = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      consultas.push(texto);
      if (['begin', 'commit', 'rollback'].includes(texto)) return { rows: [] };
      if (texto.startsWith('select id_venta, estado, venta_local from tb_venta')) return { rows: [{ ...venta }] };
      if (texto.startsWith('select id_orden_produccion, estado from tb_orden_produccion')) return { rows: orden ? [{ ...orden }] : [] };
      if (texto.includes('from tb_orden_produccion op')) return { rows: orden ? [{ ...orden }] : [] };
      if (texto.includes('from tb_detalle_orden_produccion d')) return { rows: lineas.map((l) => ({ ...l })) };
      if (texto.startsWith('update tb_detalle_orden_produccion')) {
        assert.match(texto, /set cantidad_real = cantidad_estimada/);
        for (const linea of lineas) linea.cantidad_real = linea.cantidad_estimada;
        return { rows: [] };
      }
      if (texto.startsWith('update tb_orden_produccion')) {
        assert.match(texto, /fecha_completada = now\(\) at time zone 'america\/bogota'/);
        orden.estado = params[1];
        orden.historial = JSON.parse(params[2]);
        return { rows: [] };
      }
      if (texto.startsWith('select p.tipo, c.nombre as categoria_nombre')) return { rows: productos ?? [] };
      if (texto.startsWith('update tb_venta set estado')) {
        venta.estado = params[1];
        return { rows: [] };
      }
      throw new Error(`Consulta inesperada: ${texto}`);
    },
    release() {},
  };
  const consultaAnterior = pool.query;
  const conexionAnterior = pool.connect;
  pool.connect = async () => client;
  pool.query = async (sql) => {
    const texto = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    consultas.push(texto);
    if (texto.startsWith('with completadas as')) return { rows: [] };
    if (texto.startsWith('update tb_venta')) {
      const debeCompletar = venta.estado === 'Por entregar' && orden?.estado === 'Completada' && (local || recogidaPasada);
      if (debeCompletar) venta.estado = 'Completado';
      return { rows: debeCompletar ? [{ id_venta: 31 }] : [], rowCount: debeCompletar ? 1 : 0 };
    }
    if (texto.startsWith('select id_orden_produccion from tb_orden_produccion')) return { rows: [] };
    if (texto.startsWith('select estado from tb_venta')) return { rows: [{ estado: venta.estado }] };
    if (texto.includes('u.correo, op.estado as estado_orden')) {
      notificaciones++;
      return { rows: [] };
    }
    if (texto.startsWith('select estado, venta_local from tb_venta')) {
      return { rows: [{ estado: venta.estado, venta_local: local }] };
    }
    throw new Error(`Consulta inesperada fuera de transacción: ${texto}`);
  };
  try {
    await ejecutar({ venta, orden, lineas, consultas, notificaciones: () => notificaciones });
  } finally {
    pool.connect = conexionAnterior;
    pool.query = consultaAnterior;
  }
}

for (const local of [true, false]) {
  test(`marcar lista la venta ${local ? 'local' : 'de tienda'} completa la orden y respeta la recogida`, async () => {
    await conBase({ local }, async ({ venta, orden, lineas, consultas, notificaciones }) => {
      const resultado = await marcarVentaLista(31);
      assert.equal(orden.estado, 'Completada');
      assert.deepEqual(lineas.map((l) => l.cantidad_real), [3, 2]);
      assert.deepEqual(orden.historial.map(({ de, a, detalle }) => ({ de, a, detalle })), [
        { de: 'En proceso', a: 'Completada', detalle: 'Marcado como listo' },
      ]);
      assert.match(orden.historial[0].fechaHora, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      assert.equal(venta.estado, local ? 'Completado' : 'Por entregar');
      assert.equal(resultado.estado, venta.estado);
      assert.equal(resultado.estado_orden, 'Completada');
      assert.equal(notificaciones(), 1);
      assert.equal(consultas.some((q) => /update tb_productos\b|update tb_insumo\b|insert into tb_productos_no_conformes/.test(q)), false);
    });
  });
}

test('completar la orden directamente también avanza la venta y notifica', async () => {
  await conBase({}, async ({ venta, orden, notificaciones }) => {
    const resultado = await completarOrdenProduccion(99, { lineas: null });
    assert.equal(resultado.estado, 'Completada');
    assert.equal(resultado.estado_venta, 'Completado');
    assert.equal(orden.estado, 'Completada');
    assert.equal(venta.estado, 'Completado');
    assert.equal(notificaciones(), 1);
  });
});

test('la tienda completada después de la recogida avanza inmediatamente', async () => {
  await conBase({ local: false, recogidaPasada: true }, async ({ venta }) => {
    await marcarVentaLista(31);
    assert.equal(venta.estado, 'Completado');
  });
});

test('un pedido que no está en proceso devuelve 409 sin modificarlo', async () => {
  for (const estadoOrden of ['Pendiente', 'Completada', 'Cancelada']) {
    await conBase({ estadoOrden }, async ({ orden, consultas }) => {
      await assert.rejects(completarOrdenProduccion(99, { lineas: null }), (e) => e.statusCode === 409 && /en proceso/.test(e.message));
      await assert.rejects(marcarVentaLista(31), (e) => e.statusCode === 409 && /en proceso/.test(e.message));
      assert.equal(orden.estado, estadoOrden);
      assert.equal(consultas.some((q) => q.startsWith('update ')), false);
    });
  }
});

test('una venta local sin orden solo puede completarse directamente si contiene bebidas', async () => {
  await conBase({ estadoOrden: null, productos: [{ tipo: 'Reventa', categoria_nombre: 'Bebidas' }] }, async ({ venta, notificaciones }) => {
    const resultado = await marcarVentaLista(31);
    assert.equal(venta.estado, 'Completado');
    assert.equal(resultado.estado_orden, null);
    assert.equal(notificaciones(), 1);
  });
  for (const opciones of [
    { estadoOrden: null, productos: [] },
    { estadoOrden: null, productos: [{ tipo: 'Elaborado', categoria_nombre: 'Pizza' }] },
    { estadoOrden: null, local: false },
    { estadoVenta: 'Anulado' },
  ]) {
    await conBase(opciones, async ({ consultas }) => {
      await assert.rejects(marcarVentaLista(31), (e) => e.statusCode === 409);
      assert.equal(consultas.some((q) => q.startsWith('update ')), false);
    });
  }
});
