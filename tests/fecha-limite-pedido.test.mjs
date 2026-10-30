import assert from 'node:assert/strict';
import test from 'node:test';
import AppError from '../src/errors/AppError.js';
import { validarFechaLimitePedido } from '../src/utils/fechaLimitePedido.js';

const ahoraBogota = '2026-10-29T18:00:00';

test('Pedido con recogida futura acepta límite entre ahora más un minuto y recogida', () => {
  assert.deepEqual(validarFechaLimitePedido({
    fechaLimite: '2026-10-29 18:01:00',
    ahoraBogota,
    recogidaBogota: '2026-10-29T18:30:00',
  }), { recogidaFutura: true });
  assert.deepEqual(validarFechaLimitePedido({
    fechaLimite: '2026-10-29 18:30:00',
    ahoraBogota,
    recogidaBogota: '2026-10-29T18:30:00',
  }), { recogidaFutura: true });
});

test('Pedido con recogida vencida exige límite futuro pero no aplica máximo de recogida', () => {
  assert.deepEqual(validarFechaLimitePedido({
    fechaLimite: '2026-10-29 18:45:00',
    ahoraBogota,
    recogidaBogota: '2026-10-29T17:59:00',
  }), { recogidaFutura: false });
});

test('Pedido sin hora de recogida exige límite futuro y no aplica máximo', () => {
  assert.deepEqual(validarFechaLimitePedido({
    fechaLimite: '2026-10-29 18:45:00',
    ahoraBogota,
    recogidaBogota: null,
  }), { recogidaFutura: false });
});

test('Pedido rechaza límite anterior a ahora más un minuto y límite posterior a recogida futura', () => {
  assert.throws(() => validarFechaLimitePedido({
    fechaLimite: '2026-10-29 18:00:59',
    ahoraBogota,
    recogidaBogota: '2026-10-29T18:30:00',
  }), (error) => error instanceof AppError && error.statusCode === 400);
  assert.throws(() => validarFechaLimitePedido({
    fechaLimite: '2026-10-29 18:30:01',
    ahoraBogota,
    recogidaBogota: '2026-10-29T18:30:00',
  }), (error) => error instanceof AppError && error.statusCode === 400);
});
