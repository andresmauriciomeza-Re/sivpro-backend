import assert from 'node:assert/strict';
import test from 'node:test';
import { agruparFilasPorId } from '../src/services/ordenesCompra.service.js';

test('agruparFilasPorId conserva historial, ítems y compras por orden', () => {
  const historial = [
    { id_ocompra: 9, estado: 'Borrador' },
    { id_ocompra: 8, estado: 'Enviado' },
    { id_ocompra: 9, estado: 'Enviado' },
  ];
  const items = [
    { id_ocompra: 9, id_dorcompra: 92, nombre: 'Harina' },
    { id_ocompra: 8, id_dorcompra: 81, nombre: 'Queso' },
    { id_ocompra: 9, id_dorcompra: 91, nombre: 'Tomate' },
  ];

  const historialPorOrden = agruparFilasPorId(historial, 'id_ocompra');
  const itemsPorOrden = agruparFilasPorId(items, 'id_ocompra');

  assert.deepEqual(historialPorOrden.get('9'), [
    { id_ocompra: 9, estado: 'Borrador' },
    { id_ocompra: 9, estado: 'Enviado' },
  ]);
  assert.deepEqual(itemsPorOrden.get('9'), [
    { id_ocompra: 9, id_dorcompra: 92, nombre: 'Harina' },
    { id_ocompra: 9, id_dorcompra: 91, nombre: 'Tomate' },
  ]);
  assert.deepEqual(historialPorOrden.get('8'), [
    { id_ocompra: 8, estado: 'Enviado' },
  ]);
});
