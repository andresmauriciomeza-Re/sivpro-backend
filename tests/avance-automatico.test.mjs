import assert from 'node:assert/strict';
import test from 'node:test';
import { pool } from '../src/config/db.js';
import { avanzarAutomaticamente } from '../src/services/avanceAutomatico.service.js';

test('avance automático respeta los 25 minutos y la recogida de tienda sin mover stock', async () => {
  const ordenes = [
    { id_orden_produccion: 1, id_venta: 1, tipo: 'Pedido', estado: 'En proceso', minutos: 25, estimada: 3, real: null },
    { id_orden_produccion: 2, id_venta: 2, tipo: 'Pedido', estado: 'En proceso', minutos: 24.99, estimada: 2, real: null },
    { id_orden_produccion: 3, id_venta: 3, tipo: 'Pedido', estado: 'En proceso', minutos: 26, estimada: 1, real: null },
    { id_orden_produccion: 4, id_venta: 4, tipo: 'Pedido', estado: 'En proceso', minutos: 26, estimada: 1, real: null },
    { id_orden_produccion: 5, id_venta: 5, tipo: 'Pedido', estado: 'Cancelada', minutos: 30, estimada: 1, real: null },
    { id_orden_produccion: 6, id_venta: 6, tipo: 'Preparacion', estado: 'En proceso', minutos: 30, estimada: 1, real: null },
  ];
  const ventas = [
    { id_venta: 1, local: true, minutos: 25, estado: 'Por entregar' },
    { id_venta: 2, local: true, minutos: 24.99, estado: 'Por entregar' },
    { id_venta: 3, local: false, recogidaPasada: false, estado: 'Por entregar' },
    { id_venta: 4, local: false, recogidaPasada: true, estado: 'Por entregar' },
    { id_venta: 5, local: true, minutos: 10, estado: 'Por entregar' },
    { id_venta: 7, local: true, minutos: 25, estado: 'Por entregar' },
  ];
  const original = pool.query;
  pool.query = async (sql, params) => {
    const texto = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    if (texto.startsWith('with completadas as')) {
      assert.deepEqual(params, ['America/Bogota']);
      assert.match(texto, /tipo = 'pedido' and estado = 'en proceso'/);
      assert.match(texto, /fecha_en_proceso \+ interval '25 minutes' <= now\(\) at time zone \$1::text/);
      assert.match(texto, /set cantidad_real = d\.cantidad_estimada/);
      assert.match(texto, /'automatico', true/);
      assert.doesNotMatch(texto, /tb_productos\b|tb_insumo\b/);
      const actualizadas = ordenes.filter((o) => o.tipo === 'Pedido' && o.estado === 'En proceso' && o.minutos >= 25);
      for (const o of actualizadas) { o.estado = 'Completada'; o.real = o.estimada; }
      return { rows: actualizadas.map(({ id_orden_produccion, id_venta }) => ({ id_orden_produccion, id_venta })) };
    }
    if (texto.startsWith('update tb_venta')) {
      assert.match(texto, /venta_local = true and \(\s*fecha_estado \+ interval '25 minutes'/);
      assert.match(texto, /venta_local = false and hora_recogida is not null/);
      assert.match(texto, /op\.estado = 'completada'/);
      const actualizadas = ventas.filter((v) => {
        const op = ordenes.find((o) => o.id_venta === v.id_venta && o.tipo === 'Pedido');
        return v.estado === 'Por entregar' && (v.local
          ? v.minutos >= 25 || op?.estado === 'Completada'
          : v.recogidaPasada && (!op || op.estado === 'Completada'));
      });
      for (const v of actualizadas) v.estado = 'Completado';
      return { rows: actualizadas.map(({ id_venta }) => ({ id_venta })), rowCount: actualizadas.length };
    }
    if (texto.startsWith('select id_orden_produccion from tb_orden_produccion')) return { rows: [] };
    if (texto.includes('u.correo, op.estado as estado_orden')) return { rows: [] };
    throw new Error(`Consulta inesperada: ${texto}`);
  };
  try {
    assert.equal(await avanzarAutomaticamente(), 3);
    assert.deepEqual(ordenes.map((o) => [o.estado, o.real]), [
      ['Completada', 3], ['En proceso', null], ['Completada', 1],
      ['Completada', 1], ['Cancelada', null], ['En proceso', null],
    ]);
    assert.deepEqual(ventas.map((v) => v.estado), [
      'Completado', 'Por entregar', 'Por entregar', 'Completado', 'Por entregar', 'Completado',
    ]);
    assert.equal(await avanzarAutomaticamente(), 0);
  } finally {
    pool.query = original;
  }
});
