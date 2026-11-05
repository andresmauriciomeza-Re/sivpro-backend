import assert from 'node:assert/strict';
import test from 'node:test';
import { agruparFilasPorId } from '../src/services/ventas.service.js';

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
