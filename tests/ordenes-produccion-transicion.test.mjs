import assert from 'node:assert/strict';
import test from 'node:test';
import { TRANSICIONES, validarTransicion } from '../src/services/ordenesProduccion.service.js';

test('TRANSICIONES contiene los avances y cancelaciones permitidos', () => {
  assert.deepEqual(TRANSICIONES, {
    Pendiente: ['En proceso', 'Cancelada'],
    'En proceso': ['Completada', 'Cancelada'],
    Completada: [],
    Cancelada: [],
  });
  assert.doesNotThrow(() => validarTransicion('Pendiente', 'En proceso'));
  assert.doesNotThrow(() => validarTransicion('En proceso', 'Completada'));
  assert.doesNotThrow(() => validarTransicion('Pendiente', 'Cancelada'));
  assert.doesNotThrow(() => validarTransicion('En proceso', 'Cancelada'));
});

test('validarTransicion rechaza retrocesos y estados terminales', () => {
  const casos = [
    ['En proceso', 'Pendiente'],
    ['Completada', 'En proceso'],
    ['Cancelada', 'Pendiente'],
    ['Cancelada', 'En proceso'],
    ['Cancelada', 'Completada'],
    ['Cancelada', 'Cancelada'],
  ];

  for (const [actual, destino] of casos) {
    assert.throws(
      () => validarTransicion(actual, destino),
      (error) => {
        assert.equal(error.statusCode, 409);
        assert.equal(
          error.message,
          `No se puede pasar de «${actual}» a «${destino}»: una orden no vuelve a un estado anterior.`,
        );
        return true;
      },
    );
  }
});
