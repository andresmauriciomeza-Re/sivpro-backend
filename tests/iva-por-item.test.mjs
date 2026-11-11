import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MODOS_IVA,
  UNIDADES_COMPRA,
  calcularImporteLinea,
  convertirABase,
  derivarIvaIncluidoGlobal,
  normalizarModoIva,
  resolverModoIva,
} from '../src/utils/compras.js';
import { UNIDADES_INSUMO, UNIDADES_BASE_INSUMO, UNIDADES_BASE_LEGADAS, redondearDosDecimales } from '../src/utils/insumos.js';
import { validarCrearCompra } from '../src/validators/compras.validator.js';

// ---------------------------------------------------------------------------
// Catálogos
// ---------------------------------------------------------------------------

test('catálogos: sixpack está en UNIDADES_COMPRA y MODOS_IVA tiene los 3 modos', () => {
  assert.ok(UNIDADES_COMPRA.has('sixpack'));
  assert.deepEqual([...MODOS_IVA], ['incluido', 'mas_iva', 'exento']);
});

test('catálogos: la unidad base del insumo es kg/g/lt/ml/und y las legadas siguen disponibles', () => {
  assert.deepEqual(UNIDADES_BASE_INSUMO, ['kg', 'g', 'lt', 'ml', 'und']);
  assert.deepEqual(UNIDADES_BASE_LEGADAS, ['paq', 'caja', 'bolsa']);
  // UNIDADES_INSUMO conserva las legadas para no romper insumos existentes
  // y NO agrega presentaciones nuevas (paca/sixpack nunca fueron unidad base).
  assert.deepEqual(UNIDADES_INSUMO, ['kg', 'g', 'lt', 'ml', 'und', 'paq', 'caja', 'bolsa']);
});

// ---------------------------------------------------------------------------
// Fórmulas por modo de IVA (regla 2.1)
// ---------------------------------------------------------------------------

test('modo incluido: el monto unitario ya trae el IVA', () => {
  // 2 lt × 10.000 con 19 % incluido → subtotal 20.000,00
  const r = calcularImporteLinea(2, 10000, 19, 'incluido');
  assert.equal(r.subtotal, 20000);
  assert.equal(r.base_sin_iva, 16806.72);
  assert.equal(r.monto_iva, 3193.28);
  assert.equal(r.base_sin_iva + r.monto_iva, r.subtotal);
});

test('modo mas_iva: el monto unitario es la base y el IVA se suma', () => {
  // 4 × 12.000 con 19 % más IVA → base 48.000, IVA 9.120, subtotal 57.120
  const r = calcularImporteLinea(4, 12000, 19, 'mas_iva');
  assert.equal(r.base_sin_iva, 48000);
  assert.equal(r.monto_iva, 9120);
  assert.equal(r.subtotal, 57120);
  assert.equal(r.base_sin_iva + r.monto_iva, r.subtotal);
});

test('modo exento: tarifa 0 % aunque el ítem traiga otro porcentaje', () => {
  const r = calcularImporteLinea(1, 50000, 19, 'exento');
  assert.equal(r.base_sin_iva, 50000);
  assert.equal(r.monto_iva, 0);
  assert.equal(r.subtotal, 50000);
});

test('redondeo a 2 decimales idéntico al del frontend', () => {
  // 3 × 1.234,56 con 19 % incluido → subtotal 3.703,68 (no entero)
  const r = calcularImporteLinea(3, 1234.56, 19, 'incluido');
  assert.equal(Number.isInteger(r.subtotal * 100), true);
  assert.equal(r.subtotal, 3703.68);
  // La identidad se cumple con el redondeo a 2 decimales que fija el backend
  // (la suma en coma flotante pura puede diferir en el último bit).
  assert.equal(redondearDosDecimales(r.base_sin_iva + r.monto_iva), r.subtotal);
});

// ---------------------------------------------------------------------------
// Ejemplo 2.3 (obligatorio): factura con los tres modos a la vez
// ---------------------------------------------------------------------------

test('ejemplo 2.3: factura mixta con totales exactos', () => {
  const lineas = [
    { nombre: 'Arroz', cantidad: 1, medida: 'paca', precio: 50000, iva: 0, modo: 'exento' },
    { nombre: 'Aceite', cantidad: 2, medida: 'lt', precio: 10000, iva: 19, modo: 'incluido' },
    { nombre: 'Gaseosa', cantidad: 4, medida: 'sixpack', precio: 12000, iva: 19, modo: 'mas_iva' },
  ].map((l) => ({ ...l, importe: calcularImporteLinea(l.cantidad, l.precio, l.iva, l.modo) }));

  const [arroz, aceite, gaseosa] = lineas;

  // Arroz: exento
  assert.equal(arroz.importe.base_sin_iva, 50000);
  assert.equal(arroz.importe.monto_iva, 0);
  assert.equal(arroz.importe.subtotal, 50000);

  // Aceite: incluido
  assert.equal(aceite.importe.base_sin_iva, 16806.72);
  assert.equal(aceite.importe.monto_iva, 3193.28);
  assert.equal(aceite.importe.subtotal, 20000);

  // Gaseosa: más IVA
  assert.equal(gaseosa.importe.base_sin_iva, 48000);
  assert.equal(gaseosa.importe.monto_iva, 9120);
  assert.equal(gaseosa.importe.subtotal, 57120);

  // Totales
  const totalSinIva = lineas.reduce((s, l) => s + l.importe.base_sin_iva, 0);
  const totalIva = lineas.reduce((s, l) => s + l.importe.monto_iva, 0);
  const total = lineas.reduce((s, l) => s + l.importe.subtotal, 0);

  assert.equal(totalSinIva, 114806.72);
  assert.equal(totalIva, 12313.28);
  assert.equal(total, 127120);
  assert.equal(totalSinIva + totalIva, total);
});

// ---------------------------------------------------------------------------
// Retrocompatibilidad (regla 2.1)
// ---------------------------------------------------------------------------

test('normalizarModoIva interpreta booleanos: true → incluido, false → mas_iva', () => {
  assert.equal(normalizarModoIva(true), 'incluido');
  assert.equal(normalizarModoIva(false), 'mas_iva');
  assert.equal(normalizarModoIva(undefined), 'incluido');
  assert.equal(normalizarModoIva(null), 'incluido');
  assert.equal(normalizarModoIva(' exento '), 'exento');
  assert.throws(() => normalizarModoIva('otro'), /no es válido/);
});

test('calcularImporteLinea acepta el booleano antiguo como cuarto argumento', () => {
  assert.deepEqual(calcularImporteLinea(2, 10000, 19, true), calcularImporteLinea(2, 10000, 19, 'incluido'));
  assert.deepEqual(calcularImporteLinea(4, 12000, 19, false), calcularImporteLinea(4, 12000, 19, 'mas_iva'));
  // Sin cuarto argumento se comporta como antes con iva_incluido = true
  // (así calculaban las órdenes de compra).
  assert.deepEqual(calcularImporteLinea(4, 12000, 19), calcularImporteLinea(4, 12000, 19, 'incluido'));
});

test('resolverModoIva usa el modo del ítem y, si no viene, el global', () => {
  assert.equal(resolverModoIva({ modo_iva: 'exento' }, true), 'exento');
  assert.equal(resolverModoIva({}, true), 'incluido');
  assert.equal(resolverModoIva({}, false), 'mas_iva');
  assert.equal(resolverModoIva({}, undefined), 'incluido');
  assert.equal(resolverModoIva({ modo_iva: 'mas_iva' }, true), 'mas_iva');
});

test('derivarIvaIncluidoGlobal: true si todas incluido, false si todas mas_iva, NULL si mezcla', () => {
  assert.equal(derivarIvaIncluidoGlobal([{ modo_iva: 'incluido' }, { modo_iva: 'incluido' }], undefined), true);
  assert.equal(derivarIvaIncluidoGlobal([{ modo_iva: 'mas_iva' }, { modo_iva: 'mas_iva' }], undefined), false);
  assert.equal(derivarIvaIncluidoGlobal([{ modo_iva: 'incluido' }, { modo_iva: 'mas_iva' }], undefined), null);
  assert.equal(derivarIvaIncluidoGlobal([{ modo_iva: 'exento' }], undefined), null);
  // Petición antigua: sin modos por ítem y con global → se respeta el global
  assert.equal(derivarIvaIncluidoGlobal([{}, {}], true), true);
  assert.equal(derivarIvaIncluidoGlobal([{}, {}], false), false);
});

// ---------------------------------------------------------------------------
// convertirABase (regla 2.2)
// ---------------------------------------------------------------------------

test('convertirABase caso A: kg→g y lt→ml con la conversión actual', () => {
  assert.equal(convertirABase({ cantidad: 2, medida: 'kg', unidadBase: 'g' }), 2000);
  assert.equal(convertirABase({ cantidad: 500, medida: 'g', unidadBase: 'kg' }), 0.5);
  assert.equal(convertirABase({ cantidad: 3, medida: 'lt', unidadBase: 'ml' }), 3000);
  assert.equal(convertirABase({ cantidad: 2500, medida: 'ml', unidadBase: 'lt' }), 2.5);
  assert.equal(convertirABase({ cantidad: 7, medida: 'und', unidadBase: 'und' }), 7);
});

test('convertirABase caso B: presentación con factor configurado', () => {
  // 1 paca de arroz = 20 kg → +20 kg
  assert.equal(convertirABase({ cantidad: 1, medida: 'paca', unidadBase: 'kg', factorPresentacion: 20, nombre: 'Arroz' }), 20);
  // 4 sixpack de gaseosa = 6 und → +24 und
  assert.equal(convertirABase({ cantidad: 4, medida: 'sixpack', unidadBase: 'und', factorPresentacion: 6 }), 24);
  // 2,5 bolsas = 1 kg c/u → 2,5 kg
  assert.equal(convertirABase({ cantidad: 2.5, medida: 'bolsa', unidadBase: 'kg', factorPresentacion: 1 }), 2.5);
  // El factor llega como string desde formularios/SQL
  assert.equal(convertirABase({ cantidad: 3, medida: 'caja', unidadBase: 'lt', factorPresentacion: '12' }), 36);
});

test('convertirABase: sin factor válido lanza error 400 en español', () => {
  assert.throws(
    () => convertirABase({ cantidad: 1, medida: 'paca', unidadBase: 'kg', nombre: 'Arroz' }),
    (error) => error.statusCode === 400 && /Falta el contenido de la presentación/.test(error.message) && /Arroz/.test(error.message)
  );
  assert.throws(
    () => convertirABase({ cantidad: 1, medida: 'paca', unidadBase: 'kg', factorPresentacion: 0 }),
    /Falta el contenido de la presentación/
  );
  assert.throws(
    () => convertirABase({ cantidad: 1, medida: 'paca', unidadBase: 'kg', factorPresentacion: -5 }),
    /Falta el contenido de la presentación/
  );
});

test('convertirABase: medida incompatible lanza error 400', () => {
  assert.throws(
    () => convertirABase({ cantidad: 1, medida: 'lt', unidadBase: 'kg', nombre: 'Arroz' }),
    (error) => error.statusCode === 400 && /no es compatible/.test(error.message)
  );
  // Una presentación no convertida a otra presentación sin factor
  assert.throws(
    () => convertirABase({ cantidad: 1, medida: 'sixpack', unidadBase: 'paca' }),
    /Falta el contenido de la presentación/
  );
});

test('convertirABase: insumo legado con paq/caja/bolsa como unidad base usa factor 1', () => {
  assert.equal(convertirABase({ cantidad: 4, medida: 'paq', unidadBase: 'paq' }), 4);
  assert.equal(convertirABase({ cantidad: 2, medida: 'caja', unidadBase: 'caja' }), 2);
});

test('convertirABase: cantidades inválidas lanzan error 400', () => {
  assert.throws(() => convertirABase({ cantidad: 0, medida: 'kg', unidadBase: 'g' }), /mayor que cero/);
  assert.throws(() => convertirABase({ cantidad: -1, medida: 'kg', unidadBase: 'g' }), /mayor que cero/);
  assert.throws(() => convertirABase({ cantidad: 'x', medida: 'kg', unidadBase: 'g' }), /mayor que cero/);
  assert.throws(() => convertirABase({ cantidad: 1, medida: '', unidadBase: 'kg' }), /Se requiere la medida/);
});

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

const baseCompra = () => ({
  n_factura: 'F-100',
  fecha: '2026-01-15',
  items: [{ id_insumo: 1, cantidad: 2, medida: 'lt', precio_unitario: 10000, iva: 19 }],
});

test('validator: iva_incluido global es opcional y los ítems quedan en modo incluido por defecto', () => {
  const resultado = validarCrearCompra(baseCompra());
  assert.equal(resultado.iva_incluido, true);
  assert.equal(resultado.items[0].modo_iva, 'incluido');
});

test('validator: petición antigua con iva_incluido = false marca los ítems como mas_iva', () => {
  const resultado = validarCrearCompra({ ...baseCompra(), iva_incluido: false });
  assert.equal(resultado.iva_incluido, false);
  assert.equal(resultado.items[0].modo_iva, 'mas_iva');
});

test('validator: modo_iva por ítem pisa el global y factura mixta deriva iva_incluido NULL', () => {
  const resultado = validarCrearCompra({
    ...baseCompra(),
    iva_incluido: false,
    items: [
      { id_insumo: 1, cantidad: 2, medida: 'lt', precio_unitario: 10000, iva: 19, modo_iva: 'incluido' },
      { id_insumo: 2, cantidad: 1, medida: 'paca', precio_unitario: 50000, iva: 19, modo_iva: 'mas_iva' },
    ],
  });
  assert.equal(resultado.items[0].modo_iva, 'incluido');
  assert.equal(resultado.items[1].modo_iva, 'mas_iva');
  assert.equal(resultado.iva_incluido, null);
});

test('validator: con exento el porcentaje se fuerza a 0', () => {
  const resultado = validarCrearCompra({
    ...baseCompra(),
    items: [{ id_insumo: 1, cantidad: 1, medida: 'paca', precio_unitario: 50000, iva: 19, modo_iva: 'exento' }],
  });
  assert.equal(resultado.items[0].modo_iva, 'exento');
  assert.equal(resultado.items[0].iva, 0);
});

test('validator: modo_iva inválido, cantidad y precio sin positividad', () => {
  assert.throws(
    () =>
      validarCrearCompra({
        ...baseCompra(),
        items: [{ id_insumo: 1, cantidad: 2, medida: 'lt', precio_unitario: 10000, iva: 19, modo_iva: 'naranja' }],
      }),
    /modo_iva/
  );
  assert.throws(
    () =>
      validarCrearCompra({
        ...baseCompra(),
        items: [{ id_insumo: 1, cantidad: 0, medida: 'lt', precio_unitario: 10000, iva: 19 }],
      }),
    /mayor que cero/
  );
  assert.throws(
    () =>
      validarCrearCompra({
        ...baseCompra(),
        items: [{ id_insumo: 1, cantidad: 2, medida: 'lt', precio_unitario: 0, iva: 19 }],
      }),
    /mayor que cero/
  );
  assert.throws(() => validarCrearCompra({ ...baseCompra(), iva_incluido: 'si' }), /booleano/);
});

test('validator: sixpack es una medida válida en compra', () => {
  const resultado = validarCrearCompra({
    ...baseCompra(),
    items: [{ id_insumo: 1, cantidad: 4, medida: 'sixpack', precio_unitario: 12000, iva: 19, modo_iva: 'mas_iva' }],
  });
  assert.equal(resultado.items[0].medida, 'sixpack');
  assert.equal(resultado.items[0].modo_iva, 'mas_iva');
});
