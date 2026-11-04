import assert from 'node:assert/strict';
import test from 'node:test';
import AppError from '../src/errors/AppError.js';
import { validarInsumosActivos } from '../src/utils/validarInsumosActivos.js';

const faltanteInactivo = {
  id_insumo: 12,
  nombre: 'Queso',
  requerido: 2,
  stock: 5,
  falta: 0,
  unidad: 'kg',
  motivo: 'El insumo «Queso» está inactivo',
};

test('rechaza la creación con un insumo inactivo y el mensaje de navegación', () => {
  assert.throws(
    () => validarInsumosActivos([faltanteInactivo], 400),
    (error) => error instanceof AppError
      && error.statusCode === 400
      && error.message === 'Insumo inactivo: Queso. Ve a Insumos para habilitarlo'
      && error.faltantes[0] === faltanteInactivo,
  );
});

test('rechaza iniciar con un insumo inactivo usando conflicto 409', () => {
  assert.throws(
    () => validarInsumosActivos([faltanteInactivo], 409),
    (error) => error instanceof AppError && error.statusCode === 409,
  );
});

test('no bloquea cantidades faltantes por stock cuando el insumo está activo', () => {
  assert.doesNotThrow(() => validarInsumosActivos([{
    ...faltanteInactivo,
    motivo: null,
    stock: 1,
    falta: 1,
  }]));
});
