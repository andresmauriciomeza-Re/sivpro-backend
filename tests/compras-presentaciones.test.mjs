import assert from 'node:assert/strict';
import test from 'node:test';
import {
  anularCompraEnTransaccion,
  crearCompraEnTransaccion,
} from '../src/services/compras.service.js';
import { validarItemsOrdenCompra } from '../src/services/ordenesCompra.service.js';
import { recalcularRecepcionEnTransaccion } from '../src/services/recepcionOrden.service.js';
import { validarRecepcionCompra } from '../src/validators/compras.validator.js';

/** `client` simulado: despacha por el SQL y registra cada consulta. */
function clienteFalso(despacho) {
  const llamadas = [];
  return {
    llamadas,
    async query(sql, params) {
      const registro = { sql, params };
      llamadas.push(registro);
      const respuesta = despacho(sql, params, llamadas);
      if (respuesta === undefined) {
        throw new Error(`Consulta no contemplada en el mock: ${sql.replace(/\s+/g, ' ').slice(0, 140)}`);
      }
      return respuesta;
    },
  };
}

const compraFalsa = (idCompra, extras = {}) => ({
  id_compra: idCompra,
  id_ocompra: null,
  id_proveedor: null,
  n_factura: 'F-1',
  fecha: new Date('2026-02-10T00:00:00'),
  iva_incluido: null,
  subtotal_sin_iva: 0,
  total_iva: 0,
  total: 0,
  estado: 'Recibido',
  motivo_anulacion: null,
  fecha_anulacion: null,
  proveedor_nombre: null,
  proveedor_nit: null,
  ...extras,
});

// ---------------------------------------------------------------------------
// Factura mixta (ejemplo 2.3) con los tres modos de IVA y presentaciones
// ---------------------------------------------------------------------------

test('crearCompraEnTransaccion guarda modo_iva por línea, totales mixtos y stock en unidades base', async () => {
  const insumos = {
    1: { id_insumo: 1, nombre: 'Arroz', unidad_medida: 'kg', estado: true },
    2: { id_insumo: 2, nombre: 'Aceite', unidad_medida: 'lt', estado: true },
    3: { id_insumo: 3, nombre: 'Gaseosa', unidad_medida: 'und', estado: true },
  };
  const factores = { '1:paca': 20, '3:sixpack': 6 };

  const client = clienteFalso((sql, params) => {
    if (sql.includes('INSERT INTO tb_compras')) return { rows: [{ id_compra: 77 }], rowCount: 1 };
    if (sql.includes('INSERT INTO tb_detallecompra')) return { rows: [], rowCount: 1 };
    if (sql.includes('FROM tb_insumo_presentacion')) {
      const clave = `${params[0]}:${params[1]}`;
      return { rows: factores[clave] != null ? [{ unidades_base: factores[clave] }] : [], rowCount: 0 };
    }
    if (sql.includes('SELECT id_insumo, nombre, unidad_medida, estado')) {
      const insumo = insumos[params[0]];
      return { rows: insumo ? [insumo] : [], rowCount: insumo ? 1 : 0 };
    }
    if (sql.includes('UPDATE tb_insumo')) return { rows: [], rowCount: 1 };
    if (sql.includes('LEFT JOIN tb_proveedores')) return { rows: [compraFalsa(77)], rowCount: 1 };
    if (sql.includes('FROM tb_detallecompra')) {
      return {
        rows: [
          { id_dcompra: 1, id_compra: 77, id_insumo: 1, id_producto: null, cantidad: 1, medida: 'paca',
            precio_unitario: 50000, iva: 0, modo_iva: 'exento', base_sin_iva: 50000, monto_iva: 0,
            subtotal: 50000, es_no_solicitado: false, nombre: 'Arroz', unidades_base: '20.0000', unidad_base: 'kg' },
          { id_dcompra: 2, id_compra: 77, id_insumo: 3, id_producto: null, cantidad: 4, medida: 'sixpack',
            precio_unitario: 12000, iva: 19, modo_iva: 'mas_iva', base_sin_iva: 48000, monto_iva: 9120,
            subtotal: 57120, es_no_solicitado: false, nombre: 'Gaseosa', unidades_base: '24.0000', unidad_base: 'und' },
        ],
        rowCount: 2,
      };
    }
    return undefined;
  });

  const datos = {
    n_factura: 'F-200',
    fecha: '2026-02-10',
    items: [
      { id_insumo: 1, cantidad: 1, medida: 'paca', precio_unitario: 50000, iva: 0, modo_iva: 'exento' },
      { id_insumo: 2, cantidad: 2, medida: 'lt', precio_unitario: 10000, iva: 19, modo_iva: 'incluido' },
      { id_insumo: 3, cantidad: 4, medida: 'sixpack', precio_unitario: 12000, iva: 19, modo_iva: 'mas_iva' },
    ],
  };

  const respuesta = await crearCompraEnTransaccion(client, datos);

  const insertCompra = client.llamadas.find((llamada) => llamada.sql.includes('INSERT INTO tb_compras'));
  // iva_incluido es un dato derivado: con mezcla de modos queda NULL.
  assert.equal(insertCompra.params[4], null);
  assert.equal(insertCompra.params[5], 114806.72); // subtotal_sin_iva
  assert.equal(insertCompra.params[6], 12313.28); // total_iva
  assert.equal(insertCompra.params[7], 127120); // total

  const insertsDetalle = client.llamadas.filter((llamada) => llamada.sql.includes('INSERT INTO tb_detallecompra'));
  assert.equal(insertsDetalle.length, 3);
  const [arroz, aceite, gaseosa] = insertsDetalle.map((llamada) => llamada.params);

  // Arroz: exento, 1 paca = 20 kg
  assert.equal(arroz[7], 'exento');
  assert.deepEqual(arroz.slice(8, 11), [50000, 0, 50000]);
  assert.equal(arroz[13], 20);
  assert.equal(arroz[14], 'kg');

  // Aceite: incluido, 2 lt (unidad base directa)
  assert.equal(aceite[7], 'incluido');
  assert.deepEqual(aceite.slice(8, 11), [16806.72, 3193.28, 20000]);
  assert.equal(aceite[13], 2);
  assert.equal(aceite[14], 'lt');

  // Gaseosa: más IVA, 4 sixpack = 24 und
  assert.equal(gaseosa[7], 'mas_iva');
  assert.deepEqual(gaseosa.slice(8, 11), [48000, 9120, 57120]);
  assert.equal(gaseosa[13], 24);
  assert.equal(gaseosa[14], 'und');

  // El stock entra en unidades base y el costo unitario se recalcula sobre
  // esas unidades (57.120 / 24 = 2.380).
  const updates = client.llamadas.filter((llamada) => llamada.sql.includes('UPDATE tb_insumo'));
  assert.deepEqual(updates.map((llamada) => llamada.params.slice(0, 2)), [[1, 20], [2, 2], [3, 24]]);
  assert.equal(updates[2].params[2], 2380);

  // La respuesta expone modo_iva y unidades base por línea.
  assert.equal(respuesta.detalle.length, 2);
  assert.equal(respuesta.detalle[0].modo_iva, 'exento');
  assert.equal(respuesta.detalle[0].unidades_base, 20);
  assert.equal(respuesta.detalle[0].unidad_base, 'kg');
  assert.equal(respuesta.detalle[1].modo_iva, 'mas_iva');
  assert.equal(respuesta.detalle[1].unidades_base, 24);
  assert.equal(respuesta.detalle[1].unidad_base, 'und');
});

// ---------------------------------------------------------------------------
// Anulación: se revierte exactamente lo que entró
// ---------------------------------------------------------------------------

function clienteAnulacion({ detalles, insumo }) {
  return clienteFalso((sql) => {
    if (sql.includes('FROM tb_compras') && sql.includes('FOR UPDATE')) {
      return { rows: [{ id_compra: 5, id_ocompra: null, estado: 'Recibido' }], rowCount: 1 };
    }
    if (sql.includes('FROM tb_orden_produccion')) return { rows: [], rowCount: 0 };
    if (sql.includes('FROM tb_detallecompra')) return { rows: detalles, rowCount: detalles.length };
    if (sql.includes('SELECT id_insumo, nombre, unidad_medida, stock_actual')) {
      return { rows: [insumo], rowCount: 1 };
    }
    if (sql.includes('UPDATE tb_insumo')) return { rows: [], rowCount: 1 };
    if (sql.includes('UPDATE tb_compras')) return { rows: [], rowCount: 1 };
    if (sql.includes('LEFT JOIN tb_proveedores')) return { rows: [compraFalsa(5, { estado: 'Anulado' })], rowCount: 1 };
    return undefined;
  });
}

test('anularCompraEnTransaccion revierte las unidades_base guardadas al recibir', async () => {
  const client = clienteAnulacion({
    detalles: [
      { id_insumo: 1, id_producto: null, cantidad: 1, medida: 'paca', nombre: 'Arroz', unidades_base: '20.0000' },
    ],
    insumo: { id_insumo: 1, nombre: 'Arroz', unidad_medida: 'kg', stock_actual: 100 },
  });

  await anularCompraEnTransaccion(client, 5, 'Error de digitación');

  const updateStock = client.llamadas.find((llamada) => llamada.sql.includes('UPDATE tb_insumo'));
  // Se descuentan los 20 kg que entraron, no «1 paca» (que además no
  // sería convertible sin el factor).
  assert.deepEqual(updateStock.params, [1, 20]);

  const updateCompra = client.llamadas.find((llamada) => llamada.sql.includes('UPDATE tb_compras'));
  assert.deepEqual(updateCompra.params, [5, 'Error de digitación']);
});

test('anularCompraEnTransaccion con línea antigua sin unidades_base usa la conversión histórica', async () => {
  const client = clienteAnulacion({
    detalles: [
      { id_insumo: 1, id_producto: null, cantidad: 500, medida: 'g', nombre: 'Arroz', unidades_base: null },
    ],
    insumo: { id_insumo: 1, nombre: 'Arroz', unidad_medida: 'kg', stock_actual: 10 },
  });

  await anularCompraEnTransaccion(client, 5, 'Error de digitación');

  const updateStock = client.llamadas.find((llamada) => llamada.sql.includes('UPDATE tb_insumo'));
  // 500 g → 0,5 kg con la conversión antigua.
  assert.deepEqual(updateStock.params, [1, 0.5]);
});

// ---------------------------------------------------------------------------
// Orden de compra: presentaciones en el ítem pedido
// ---------------------------------------------------------------------------

function clienteOrden({ insumo, factores = {} }) {
  return clienteFalso((sql, params) => {
    if (sql.includes('FROM tb_insumo_presentacion')) {
      const clave = `${params[0]}:${params[1]}`;
      return { rows: factores[clave] != null ? [{ unidades_base: factores[clave] }] : [], rowCount: 0 };
    }
    if (sql.includes('SELECT id_insumo, nombre, unidad_medida, estado')) {
      return { rows: insumo ? [insumo] : [], rowCount: insumo ? 1 : 0 };
    }
    return undefined;
  });
}

const itemOrden = (extras = {}) => ({
  id_insumo: 1,
  cantidad: 2,
  medida: 'paca',
  precio_unitario: 50000,
  iva: 0,
  modo_iva: 'incluido',
  ...extras,
});

test('validarItemsOrdenCompra acepta una presentación con factor configurado y guarda unidades_base', async () => {
  const client = clienteOrden({
    insumo: { id_insumo: 1, nombre: 'Arroz', unidad_medida: 'kg', estado: true },
    factores: { '1:paca': 20 },
  });

  const [item] = await validarItemsOrdenCompra(client, [itemOrden()]);

  assert.equal(item.medida, 'paca');
  assert.equal(item.nombre, 'Arroz');
  assert.equal(item.unidades_base, 40); // 2 pacas × 20 kg
  assert.equal(item.unidad_base, 'kg');
});

test('validarItemsOrdenCompra acepta el factor proporcionado en la petición sin tenerlo configurado', async () => {
  const client = clienteOrden({
    insumo: { id_insumo: 1, nombre: 'Arroz', unidad_medida: 'kg', estado: true },
    factores: {},
  });

  const [item] = await validarItemsOrdenCompra(client, [itemOrden({ factor_presentacion: 25 })]);

  assert.equal(item.unidades_base, 50); // 2 × 25
  assert.equal(item.unidad_base, 'kg');
  // No se consultó la tabla de presentaciones (el factor venía en el ítem).
  assert.equal(client.llamadas.some((llamada) => llamada.sql.includes('tb_insumo_presentacion')), false);
});

test('validarItemsOrdenCompra rechaza una presentación sin factor configurado', async () => {
  const client = clienteOrden({
    insumo: { id_insumo: 1, nombre: 'Arroz', unidad_medida: 'kg', estado: true },
    factores: {},
  });

  await assert.rejects(
    () => validarItemsOrdenCompra(client, [itemOrden()]),
    (error) => error.statusCode === 400 && /Falta el contenido de la presentación/.test(error.message) && /Arroz/.test(error.message)
  );
});

test('validarItemsOrdenCompra acepta la unidad del insumo sin distinguir mayúsculas', async () => {
  const client = clienteOrden({
    insumo: { id_insumo: 1, nombre: 'Arroz', unidad_medida: 'KG', estado: true },
    factores: {},
  });

  const [item] = await validarItemsOrdenCompra(client, [itemOrden({ medida: 'kg', cantidad: 3 })]);

  assert.equal(item.medida, 'KG');
  assert.equal(item.unidades_base, 3);
  assert.equal(item.unidad_base, 'KG');
  assert.equal(client.llamadas.some((llamada) => llamada.sql.includes('tb_insumo_presentacion')), false);
});

test('validarItemsOrdenCompra rechaza una medida incompatible con el insumo', async () => {
  const client = clienteOrden({
    insumo: { id_insumo: 1, nombre: 'Arroz', unidad_medida: 'kg', estado: true },
    factores: {},
  });

  await assert.rejects(
    () => validarItemsOrdenCompra(client, [itemOrden({ medida: 'lt' })]),
    (error) => error.statusCode === 400 && /no es compatible/.test(error.message)
  );
});

// ---------------------------------------------------------------------------
// Insumo no solicitado nuevo en presentación
// ---------------------------------------------------------------------------

test('un insumo nuevo recibido en sixpack se crea con unidad base y el stock convertido', async () => {
  const client = clienteFalso((sql, params) => {
    if (sql.includes('INSERT INTO tb_compras')) return { rows: [{ id_compra: 88 }], rowCount: 1 };
    if (sql.includes('INSERT INTO tb_insumo_presentacion')) return { rows: [], rowCount: 1 };
    if (sql.includes('INSERT INTO tb_insumo')) return { rows: [{ id_insumo: 9, nombre: 'Gaseosa' }], rowCount: 1 };
    if (sql.includes('INSERT INTO tb_detallecompra')) return { rows: [], rowCount: 1 };
    if (sql.includes('FROM tb_categoria_insumos')) {
      return { rows: [{ id_categoria_insumo: 2, nombre: 'Bebidas', estado: true }], rowCount: 1 };
    }
    if (sql.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 0 };
    if (sql.includes('SELECT id_insumo, nombre FROM tb_insumo')) return { rows: [], rowCount: 0 };
    if (sql.includes('LEFT JOIN tb_proveedores')) return { rows: [compraFalsa(88)], rowCount: 1 };
    if (sql.includes('FROM tb_detallecompra')) {
      return {
        rows: [
          { id_dcompra: 9, id_compra: 88, id_insumo: 9, id_producto: null, cantidad: 4, medida: 'sixpack',
            precio_unitario: 12000, iva: 19, modo_iva: 'mas_iva', base_sin_iva: 48000, monto_iva: 9120,
            subtotal: 57120, es_no_solicitado: true, nombre: 'Gaseosa', unidades_base: '24.0000', unidad_base: 'und' },
        ],
        rowCount: 1,
      };
    }
    return undefined;
  });

  const resultado = await crearCompraEnTransaccion(
    client,
    { n_factura: 'F-300', fecha: '2026-02-11', items: [] },
    {
      id_proveedor: null,
      itemsNoSolicitados: [
        {
          nuevo_insumo: true,
          nombre: 'Gaseosa',
          id_categoria_insumo: 2,
          medida: 'sixpack',
          unidad_base: 'und',
          factor_presentacion: 6,
          cantidad: 4,
          precio_unitario: 12000,
          iva: 19,
          modo_iva: 'mas_iva',
          stock_minimo: 0,
        },
      ],
    }
  );

  assert.equal(resultado.detalle.length, 1);
  assert.equal(resultado.detalle[0].modo_iva, 'mas_iva');
  assert.equal(resultado.detalle[0].unidades_base, 24);
  assert.equal(resultado.detalle[0].unidad_base, 'und');

  const insertInsumo = client.llamadas.find((llamada) => llamada.sql.includes('INSERT INTO tb_insumo'));
  // unidad base 'und', stock 4 × 6 = 24 und, costo 57.120 / 24 = 2.380
  assert.deepEqual(insertInsumo.params, [2, 'Gaseosa', 'und', 24, 0, 2380, 19]);

  const insertPresentacion = client.llamadas.find((llamada) => llamada.sql.includes('INSERT INTO tb_insumo_presentacion'));
  assert.deepEqual(insertPresentacion.params, [9, 'sixpack', 6]);

  const insertDetalle = client.llamadas.find((llamada) => llamada.sql.includes('INSERT INTO tb_detallecompra'));
  assert.equal(insertDetalle.params[7], 'mas_iva');
  assert.equal(insertDetalle.params[10], 57120);
  assert.equal(insertDetalle.params[13], 24);
  assert.equal(insertDetalle.params[14], 'und');

  const insertCompra = client.llamadas.find((llamada) => llamada.sql.includes('INSERT INTO tb_compras'));
  assert.equal(insertCompra.params[4], false); // todas las líneas mas_iva
});

test('un insumo nuevo en paca sin unidad_base y factor responde 400 en español', async () => {
  const client = clienteFalso((sql) => {
    if (sql.includes('FROM tb_categoria_insumos')) {
      return { rows: [{ id_categoria_insumo: 2, nombre: 'Bebidas', estado: true }], rowCount: 1 };
    }
    if (sql.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 0 };
    if (sql.includes('SELECT id_insumo, nombre FROM tb_insumo')) return { rows: [], rowCount: 0 };
    if (sql.includes('INSERT INTO tb_compras')) return { rows: [{ id_compra: 89 }], rowCount: 1 };
    return undefined;
  });

  await assert.rejects(
    () =>
      crearCompraEnTransaccion(
        client,
        { n_factura: 'F-301', fecha: '2026-02-11', items: [] },
        {
          id_proveedor: null,
          itemsNoSolicitados: [
            {
              nuevo_insumo: true,
              nombre: 'Arroz',
              id_categoria_insumo: 2,
              medida: 'paca',
              cantidad: 1,
              precio_unitario: 50000,
              iva: 0,
              modo_iva: 'exento',
              stock_minimo: 0,
            },
          ],
        }
      ),
    (error) => error.statusCode === 400 && /unidad_base/.test(error.message) && /factor_presentacion/.test(error.message)
  );
});

// ---------------------------------------------------------------------------
// Recepción: comparar en unidades base (1 paca pedida vs 20 kg recibidos)
// ---------------------------------------------------------------------------

test('recalcularRecepcionEnTransaccion cumple 1 paca con 20 kg recibidos', async () => {
  const client = clienteFalso((sql) => {
    if (sql.includes('FROM tb_detalleordencompra')) {
      return {
        rows: [
          { id_dorcompra: 1, id_insumo: 1, id_producto: null, cantidad: 1, medida: 'paca',
            nombre: 'Arroz', unidades_base: '20.0000', unidad_base: 'kg' },
        ],
        rowCount: 1,
      };
    }
    if (sql.includes('FROM tb_compras')) return { rows: [{ id_compra: 10 }], rowCount: 1 };
    if (sql.includes('FROM tb_detallecompra')) {
      return {
        rows: [
          { id_compra: 10, id_insumo: 1, id_producto: null, cantidad: 20, medida: 'kg',
            es_no_solicitado: false, nombre: 'Arroz', unidades_base: '20.0000' },
        ],
        rowCount: 1,
      };
    }
    if (sql.includes('INSERT INTO tb_recepcion_orden')) return { rows: [], rowCount: 1 };
    return undefined;
  });

  const { recepcion, completado } = await recalcularRecepcionEnTransaccion(client, 3);

  const [item] = recepcion.items;
  assert.equal(item.solicitada, 1);
  assert.equal(item.recibida, 1); // 20 kg = 1 paca: queda expressado en la unidad de la orden
  assert.equal(item.pendiente, 0);
  assert.equal(item.unidad, 'paca');
  assert.equal(item.unidades_base, 20);
  assert.equal(item.unidad_base, 'kg');
  assert.equal(completado, true);

  // El JSON persistido conserva la unidad de la orden para el frontend.
  const guardar = client.llamadas.find((llamada) => llamada.sql.includes('INSERT INTO tb_recepcion_orden'));
  const json = JSON.parse(guardar.params[1]);
  assert.equal(json.items[0].recibida, 1);
  assert.equal(json.items[0].unidad, 'paca');
});

// ---------------------------------------------------------------------------
// Validadores (regla 2.2 en la petición de recepción)
// ---------------------------------------------------------------------------

const baseRecepcion = (itemsNoSolicitados) => ({
  n_factura: 'F-400',
  fecha: '2026-02-12',
  items: [],
  items_no_solicitados: itemsNoSolicitados,
});

test('validator: acepta insumo nuevo en presentación con unidad_base y factor_presentacion', () => {
  const resultado = validarRecepcionCompra(
    baseRecepcion([
      {
        nombre: 'Gaseosa',
        id_categoria_insumo: 2,
        medida: 'sixpack',
        unidad_base: 'und',
        factor_presentacion: 6,
        cantidad: 4,
        precio_unitario: 12000,
        iva: 19,
      },
    ])
  );
  const item = resultado.items_no_solicitados[0];
  assert.equal(item.medida, 'sixpack');
  assert.equal(item.unidad_base, 'und');
  assert.equal(item.factor_presentacion, 6);
});

test('validator: paca/sixpack como insumo nuevo exige unidad_base y factor_presentacion', () => {
  assert.throws(
    () =>
      validarRecepcionCompra(
        baseRecepcion([
          { nombre: 'Arroz', id_categoria_insumo: 2, medida: 'paca', cantidad: 1, precio_unitario: 50000, iva: 0 },
        ])
      ),
    (error) => error.statusCode === 400 && /unidad_base/.test(error.message) && /factor_presentacion/.test(error.message)
  );
});

test('validator: factor_presentacion sin unidad_base se rechaza', () => {
  assert.throws(
    () =>
      validarRecepcionCompra(
        baseRecepcion([
          {
            nombre: 'Arroz',
            id_categoria_insumo: 2,
            medida: 'paca',
            factor_presentacion: 20,
            cantidad: 1,
            precio_unitario: 50000,
            iva: 0,
          },
        ])
      ),
    (error) => error.statusCode === 400 && /debes indicar también unidad_base/.test(error.message)
  );
});

test('validator: unidad_base fuera del catálogo base se rechaza', () => {
  assert.throws(
    () =>
      validarRecepcionCompra(
        baseRecepcion([
          {
            nombre: 'Gaseosa',
            id_categoria_insumo: 2,
            medida: 'sixpack',
            unidad_base: 'sixpack',
            factor_presentacion: 6,
            cantidad: 4,
            precio_unitario: 12000,
            iva: 19,
          },
        ])
      ),
    (error) => error.statusCode === 400 && /unidad_base/.test(error.message)
  );
});
