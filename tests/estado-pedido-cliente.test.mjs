import assert from 'node:assert/strict';
import test from 'node:test';
import { estadoClientePedido, PASOS_PEDIDO } from '../src/utils/estadoPedidoCliente.js';

test('expone los cinco pasos del seguimiento en orden', () => {
  assert.deepEqual(PASOS_PEDIDO, [
    'Pendiente',
    'Aceptado',
    'En proceso',
    'Por entregar',
    'Completado',
  ]);
});

test('mapea estados directos de la venta para el cliente', () => {
  assert.equal(estadoClientePedido({ estadoVenta: 'Por verificar' }), 'Pendiente');
  assert.equal(estadoClientePedido({ estadoVenta: 'En espera' }), 'En espera');
  assert.equal(estadoClientePedido({ estadoVenta: 'Completado' }), 'Completado');
  assert.equal(estadoClientePedido({ estadoVenta: 'Devolucion' }), 'Devolución');
});

test('mapea Por entregar según exista y avance su orden', () => {
  assert.equal(
    estadoClientePedido({ estadoVenta: 'Por entregar', tieneOrden: false }),
    'Por entregar',
  );
  for (const estadoOrden of ['Pendiente', 'Cancelada']) {
    assert.equal(
      estadoClientePedido({ estadoVenta: 'Por entregar', estadoOrden, tieneOrden: true }),
      'Aceptado',
    );
  }
  assert.equal(
    estadoClientePedido({ estadoVenta: 'Por entregar', estadoOrden: 'En proceso', tieneOrden: true }),
    'En proceso',
  );
  assert.equal(
    estadoClientePedido({ estadoVenta: 'Por entregar', estadoOrden: 'Completada', tieneOrden: true }),
    'Por entregar',
  );
});

test('Anulado solo se muestra como Rechazado para un rechazo de verificación del administrador', () => {
  assert.equal(
    estadoClientePedido({
      estadoVenta: 'Anulado',
      anulado_por: 'Administrador',
      motivo_rechazo: 'Comprobante falso',
    }),
    'Rechazado',
  );
  assert.equal(
    estadoClientePedido({
      estadoVenta: 'Anulado',
      anulado_por: 'Administrador',
      motivo_rechazo: 'Otro: imagen ilegible',
    }),
    'Rechazado',
  );
  assert.equal(
    estadoClientePedido({
      estadoVenta: 'Anulado',
      anulado_por: 'Administrador',
      motivo_rechazo: 'Error al registrar el pedido',
    }),
    'Anulado',
  );
  assert.equal(
    estadoClientePedido({
      estadoVenta: 'Anulado',
      anulado_por: 'Cliente',
      motivo_rechazo: 'Cliente canceló el pedido',
    }),
    'Anulado',
  );
  assert.equal(estadoClientePedido({ estadoVenta: 'Anulado' }), 'Anulado');
});
