import assert from 'node:assert/strict';
import test from 'node:test';
import { pool } from '../src/config/db.js';
import { agruparFilasPorId, listarVentas } from '../src/services/ventas.service.js';

test('agruparFilasPorId conserva las filas y su orden por venta o devolución', () => {
  const filasDetalle = [
    { _id_venta: 21, id_detalle_venta: 212, nombre: 'Pizza' },
    { _id_venta: 20, id_detalle_venta: 201, nombre: 'Salsa' },
    { _id_venta: 21, id_detalle_venta: 211, nombre: 'Bebida' },
  ];
  const filasDevolucion = [
    { _id_devolucion: 4, id_detalle_venta: 212, motivo: 'Fría' },
    { _id_devolucion: 3, id_detalle_venta: 201, motivo: 'Tarde' },
    { _id_devolucion: 4, id_detalle_venta: 211, motivo: 'Otro' },
  ];

  const detallesPorVenta = agruparFilasPorId(filasDetalle, '_id_venta');
  const lineasPorDevolucion = agruparFilasPorId(filasDevolucion, '_id_devolucion');

  assert.deepEqual(detallesPorVenta.get('21'), [
    { _id_venta: 21, id_detalle_venta: 212, nombre: 'Pizza' },
    { _id_venta: 21, id_detalle_venta: 211, nombre: 'Bebida' },
  ]);
  assert.deepEqual(detallesPorVenta.get('20'), [
    { _id_venta: 20, id_detalle_venta: 201, nombre: 'Salsa' },
  ]);
  assert.deepEqual(lineasPorDevolucion.get('4'), [
    { _id_devolucion: 4, id_detalle_venta: 212, motivo: 'Fría' },
    { _id_devolucion: 4, id_detalle_venta: 211, motivo: 'Otro' },
  ]);
  assert.deepEqual(lineasPorDevolucion.get('3'), [
    { _id_devolucion: 3, id_detalle_venta: 201, motivo: 'Tarde' },
  ]);
});

test('el listado expone venta local y hora de finalización calculada con fecha_estado', async () => {
  const original = pool.query;
  pool.query = async (sql, params) => {
    const consulta = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    if (consulta.startsWith('with completadas as')) return { rows: [] };
    if (consulta.startsWith('update tb_venta')) return { rows: [], rowCount: 0 };
    if (consulta.startsWith('select id_orden_produccion from tb_orden_produccion')) return { rows: [] };
    if (consulta.includes('from tb_venta v')) {
      assert.match(consulta, /v\.venta_local/);
      assert.match(consulta, /to_char\(v\.fecha_estado \+ interval '25 minutes', 'hh24:mi'\) as hora_completado_local/);
      assert.match(consulta, /as fin_venta_local_ms/);
      assert.match(consulta, /as fin_calentamiento_ms/);
      assert.match(consulta, /at time zone 'america\/bogota'/);
      assert.match(consulta, /v\.id_venta = \$1::int/);
      assert.deepEqual(params, [31]);
      return { rows: [{
        id_venta: 31, estado: 'Por entregar', venta_local: true,
        hora_completado_local: '00:10', estado_orden: null,
      }] };
    }
    if (consulta.includes('from tb_detalle_venta') || consulta.includes('from tb_pagos')) return { rows: [] };
    throw new Error(`Consulta no esperada en prueba: ${consulta}`);
  };
  try {
    const ventas = await listarVentas({ idVenta: 31 });
    assert.equal(ventas[0].venta_local, true);
    assert.equal(ventas[0].hora_completado_local, '00:10');
  } finally {
    pool.query = original;
  }
});
