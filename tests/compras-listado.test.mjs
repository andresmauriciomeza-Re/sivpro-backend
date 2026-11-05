import assert from 'node:assert/strict';
import test from 'node:test';
import { agruparFilasPorId } from '../src/services/compras.service.js';

test('agruparFilasPorId conserva las líneas de cada compra y su orden', () => {
  const filas = [
    { id_compra: 8, id_dcompra: 82, nombre: 'Harina' },
    { id_compra: 7, id_dcompra: 71, nombre: 'Queso' },
    { id_compra: 8, id_dcompra: 81, nombre: 'Tomate' },
  ];

  const agrupadas = agruparFilasPorId(filas, 'id_compra');

  assert.deepEqual(agrupadas.get('8'), [
    { id_compra: 8, id_dcompra: 82, nombre: 'Harina' },
    { id_compra: 8, id_dcompra: 81, nombre: 'Tomate' },
  ]);
  assert.deepEqual(agrupadas.get('7'), [
    { id_compra: 7, id_dcompra: 71, nombre: 'Queso' },
  ]);
});
