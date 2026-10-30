import assert from 'node:assert/strict';
import test from 'node:test';
import AppError from '../src/errors/AppError.js';
import { validarCompletarOrdenProduccion } from '../src/validators/ordenesProduccion.validator.js';

test('la verificación solo acepta cantidades reales y descarta cantidad debida enviada por el cliente', () => {
  const resultado = validarCompletarOrdenProduccion({
    lineas: [{ id_detalle_op: 7, cantidad_real: 12, cantidad_debida: 999 }],
  });

  assert.deepEqual(resultado, {
    lineas: [{ id_detalle_op: 7, cantidad_real: 12 }],
  });
});

test('la cantidad real de verificación debe ser un entero no negativo', () => {
  for (const cantidad_real of [-1, 1.5]) {
    assert.throws(
      () => validarCompletarOrdenProduccion({
        lineas: [{ id_detalle_op: 7, cantidad_real }],
      }),
      (error) => error instanceof AppError && error.statusCode === 400,
    );
  }
});
