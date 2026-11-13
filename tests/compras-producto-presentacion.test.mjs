import assert from 'node:assert/strict';
import test from 'node:test';
import { resolverEmpaqueProducto } from '../src/utils/compras.js';

const paca12 = { nombre: 'Gaseosa', unidad_compra: 'paca', unidad_venta: 'und', unidades_por_empaque: 12 };
const suelto = { nombre: 'Agua', unidad_compra: 'und', unidad_venta: 'und', unidades_por_empaque: null };

test('punto 6: la unidad de compra del catálogo sin contenido usa el empaque del catálogo', () => {
  assert.deepEqual(resolverEmpaqueProducto(paca12, { medida: 'paca' }), { medida: 'paca', empaque: 12, delCatalogo: true });
  assert.deepEqual(resolverEmpaqueProducto(suelto, { medida: 'und' }), { medida: 'und', empaque: 1, delCatalogo: true });
});

test('punto 6: el contenido de la línea manda sobre el catálogo', () => {
  assert.deepEqual(
    resolverEmpaqueProducto(paca12, { medida: 'paca', factor_presentacion: 12 }),
    { medida: 'paca', empaque: 12, delCatalogo: true },
  );
  assert.deepEqual(
    resolverEmpaqueProducto(paca12, { medida: 'paca', factor_presentacion: 24 }),
    { medida: 'paca', empaque: 24, delCatalogo: false },
  );
  assert.deepEqual(
    resolverEmpaqueProducto(paca12, { medida: 'caja', factor_presentacion: '6' }),
    { medida: 'caja', empaque: 6, delCatalogo: false },
  );
  assert.deepEqual(
    resolverEmpaqueProducto(suelto, { medida: 'sixpack', factor_presentacion: 6 }),
    { medida: 'sixpack', empaque: 6, delCatalogo: false },
  );
});

test('punto 6: la unidad suelta de un producto en paca entra de a 1', () => {
  assert.deepEqual(
    resolverEmpaqueProducto(paca12, { medida: 'und', factor_presentacion: 1 }),
    { medida: 'und', empaque: 1, delCatalogo: false },
  );
});

test('punto 6: otra presentación sin contenido o una medida ajena se rechazan con 400', () => {
  assert.throws(() => resolverEmpaqueProducto(paca12, { medida: 'caja' }), (e) => e.statusCode === 400 && /contenido/.test(e.message));
  assert.throws(() => resolverEmpaqueProducto(paca12, { medida: 'kg' }), (e) => e.statusCode === 400 && /no coincide/.test(e.message));
  assert.throws(
    () => resolverEmpaqueProducto({ ...paca12, unidades_por_empaque: null }, { medida: 'paca' }),
    (e) => e.statusCode === 400 && /empaque/.test(e.message),
  );
});
