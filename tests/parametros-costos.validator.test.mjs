import assert from 'node:assert/strict';
import test from 'node:test';
import AppError from '../src/errors/AppError.js';
import { validarActualizarParametrosCostos } from '../src/validators/parametrosCostos.validator.js';

const valoresValidos = {
  mano_obra_hora: 12673,
  tarifa_gas_m3: 0,
  consumo_gas_m3_hora: 0,
  margen_ganancia: 40,
};

test('acepta los parámetros de costos completos y conserva sus valores numéricos', () => {
  assert.deepEqual(validarActualizarParametrosCostos(valoresValidos), valoresValidos);
});

test('rechaza valores negativos', () => {
  assert.throws(
    () => validarActualizarParametrosCostos({ ...valoresValidos, mano_obra_hora: -1 }),
    (error) => error instanceof AppError && error.statusCode === 400,
  );
});

test('rechaza campos ausentes y texto no numérico', () => {
  const sinManoObra = {
    tarifa_gas_m3: valoresValidos.tarifa_gas_m3,
    consumo_gas_m3_hora: valoresValidos.consumo_gas_m3_hora,
    margen_ganancia: valoresValidos.margen_ganancia,
  };
  assert.throws(
    () => validarActualizarParametrosCostos(sinManoObra),
    (error) => error instanceof AppError && error.statusCode === 400,
  );
  assert.throws(
    () => validarActualizarParametrosCostos({ ...valoresValidos, margen_ganancia: 'abc' }),
    (error) => error instanceof AppError && error.statusCode === 400,
  );
});
