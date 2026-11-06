import assert from 'node:assert/strict';
import test from 'node:test';
import AppError from '../src/errors/AppError.js';
import {
  validarCompletarOrdenProduccion,
  validarCrearOrdenProduccion,
} from '../src/validators/ordenesProduccion.validator.js';

const ordenPreparacionValida = { lineas: [{ id_producto: 7, cantidad: 3 }] };

test('la creación de una orden valida stock por defecto y permite desactivarlo explícitamente', () => {
  assert.equal(validarCrearOrdenProduccion(ordenPreparacionValida).validar_stock, true);
  assert.equal(
    validarCrearOrdenProduccion({ ...ordenPreparacionValida, validar_stock: false }).validar_stock,
    false,
  );
});

test('validar_stock debe ser booleano al crear una orden', () => {
  assert.throws(
    () => validarCrearOrdenProduccion({ ...ordenPreparacionValida, validar_stock: 'false' }),
    (error) => error instanceof AppError && error.statusCode === 400,
  );
});

test('la verificación solo acepta cantidades reales y descarta cantidad debida enviada por el cliente', () => {
  const resultado = validarCompletarOrdenProduccion({
    lineas: [{ id_detalle_op: 7, cantidad_real: 12, cantidad_debida: 999 }],
  });

  assert.deepEqual(resultado, {
    lineas: [{ id_detalle_op: 7, cantidad_real: 12 }],
  });
});

test('una OP acepta la misma pizza en Mediana y Grande pero no repite el mismo tamaño', () => {
  const datos = validarCrearOrdenProduccion({
    lineas: [
      { id_producto: 7, cantidad: 2, tamano: 'Mediana' },
      { id_producto: 7, cantidad: 1, tamano: 'Grande' },
    ],
  });
  assert.deepEqual(datos.lineas.map((l) => [l.tamano, l.cantidad]), [['Mediana', 2], ['Grande', 1]]);
  assert.throws(
    () => validarCrearOrdenProduccion({
      lineas: [
        { id_producto: 7, cantidad: 2, tamano: 'Grande' },
        { id_producto: 7, cantidad: 1, tamano: 'Grande' },
      ],
    }),
    (error) => error instanceof AppError && error.statusCode === 400,
  );
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
