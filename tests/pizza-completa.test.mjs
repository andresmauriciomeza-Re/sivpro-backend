import assert from 'node:assert/strict';
import test from 'node:test';
import { pool } from '../src/config/db.js';
import { crearPreparacionEnTransaccion, completarOrdenProduccion } from '../src/services/ordenesProduccion.service.js';
import { validarCompletarOrdenProduccion } from '../src/validators/ordenesProduccion.validator.js';
import { calcularRequeridosProduccion } from '../src/utils/produccion.js';
import { crearVersionFicha } from '../src/services/fichas.service.js';

function clienteOrden({ mediana = 1000, grande = 1400, tamano = null, cantidad = 2 } = {}) {
  const estado = { partes: 0, consultas: [], historial: [] };
  const orden = { id_orden_produccion: 1, tipo: 'Preparacion', estado: 'En proceso', stock_aplicado: false, historial: [] };
  const linea = {
    id_detalle_op: 11, id_producto: 7, id_insumo: null, id_ft: null, nombre: 'Pizza',
    tamano, cantidad_estimada: cantidad, cantidad_debida: cantidad,
    insumos_consumidos: { insumos: [] }, cantidad_real: null, unidad: 'und',
  };
  return {
    estado,
    async query(sql, params = []) {
      const q = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      estado.consultas.push(q);
      if (['begin', 'commit', 'rollback'].includes(q)) return { rows: [] };
      if (q.includes('from tb_orden_produccion op')) return { rows: [orden] };
      if (q.includes('from tb_detalle_orden_produccion d')) return { rows: [linea] };
      if (q.startsWith('select c.nombre from tb_productos p')) return { rows: [{ nombre: 'Pizza' }] };
      if (q.startsWith('select precio_venta, precio_grande')) return { rows: [{ precio_venta: mediana, precio_grande: grande }] };
      if (q.startsWith('update tb_productos') && q.includes('stock_partes = stock_partes + $2::int')) {
        assert.equal(params[0], 7);
        estado.partes += params[1];
        return { rows: [], rowCount: 1 };
      }
      if (q.startsWith('update tb_detalle_orden_produccion')) return { rows: [], rowCount: 1 };
      if (q.startsWith('update tb_orden_produccion')) {
        estado.historial = JSON.parse(params[2]);
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Consulta inesperada: ${q}`);
    },
    release() {},
  };
}

async function conCliente(client, callback) {
  const anterior = pool.connect;
  pool.connect = async () => client;
  try { return await callback(); } finally { pool.connect = anterior; }
}

test('pizza sin tamaño: una pizza suma 24 partes', async () => {
  const client = clienteOrden({ cantidad: 1 });
  const datos = validarCompletarOrdenProduccion({
    lineas: [{ id_detalle_op: 11, cantidad_real: 1 }],
  });
  await conCliente(client, () => completarOrdenProduccion(1, datos));
  assert.equal(client.estado.partes, 24);
});

test('pizza sin tamaño rechaza una cantidad real superior a la debida', async () => {
  const client = clienteOrden();
  const datos = validarCompletarOrdenProduccion({
    lineas: [{ id_detalle_op: 11, cantidad_real: 3 }],
  });
  await assert.rejects(conCliente(client, () => completarOrdenProduccion(1, datos)),
    (error) => error.statusCode === 400 && /mayor que la cantidad que debías hacer/.test(error.message));
  assert.equal(client.estado.consultas.some((q) => q.startsWith('update tb_productos')), false);
});

test('exige los precios para ambos tamaños al completar', async () => {
  for (const [mediana, grande] of [[0, 1400], [1000, 0]]) {
    const client = clienteOrden({ mediana, grande });
    const datos = validarCompletarOrdenProduccion({
      lineas: [{ id_detalle_op: 11, cantidad_real: 2 }],
    });
    await assert.rejects(conCliente(client, () => completarOrdenProduccion(1, datos)), (error) => error.statusCode === 400);
    assert.equal(client.estado.consultas.some((q) => q.startsWith('update tb_productos')), false);
  }
});

test('una línea antigua Grande suma 6 porciones de 4 partes por pizza', async () => {
  const client = clienteOrden({ tamano: 'Grande' });
  const datos = validarCompletarOrdenProduccion({ lineas: [{ id_detalle_op: 11, cantidad_real: 2 }] });
  await conCliente(client, () => completarOrdenProduccion(1, datos));
  assert.equal(client.estado.partes, 48);
});

test('la ficha de pizza exige ocho porciones de referencia', async () => {
  const client = { async query(sql) {
    const q = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    if (['begin', 'commit', 'rollback'].includes(q)) return { rows: [] };
    if (q.includes('from tb_productos p')) return { rows: [{ id_producto: 7, tipo: 'Elaborado', categoria_nombre: 'Pizza' }] };
    if (q.startsWith('select id_insumo, nombre')) return { rows: [] };
    throw new Error(`Consulta inesperada: ${q}`);
  }, release() {} };
  await assert.rejects(conCliente(client, () => crearVersionFicha({ id_producto: 7, cantidad: 1, medida: 'und', porciones: 6, insumos: [] })),
    (error) => error.statusCode === 400 && /8 porciones/.test(error.message));
  await assert.rejects(conCliente(client, () => crearVersionFicha({ id_producto: 7, cantidad: 1, medida: 'und', porciones: 8, insumos: [{ id_insumo: 3 }] })),
    (error) => error.statusCode === 400 && /insumos de la ficha no existen/.test(error.message));
});

test('insumos de pizza completa no se escalan por el corte ni por porciones antiguas de la ficha', async () => {
  const client = { async query(sql) {
    const q = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    if (q.startsWith('select p.id_producto')) return { rows: [{
      id_producto: 7, nombre: 'Pizza', tipo: 'Elaborado', categoria_nombre: 'Pizza',
      id_ft: 11, cantidad: 1, medida: 'und', porciones: 6, pasos: [],
    }] };
    if (q.includes('from tb_insumo_ficha_tecnica')) return { rows: [{
      id_ft: 11, id_insumo: 3, cantidad: 0.5, medida: 'kg', nombre: 'Harina', unidad_medida: 'kg', stock_actual: 10, estado: true,
    }] };
    if (q.startsWith('select id_insumo, nombre')) return { rows: [{ id_insumo: 3, nombre: 'Harina', unidad_medida: 'kg', stock_actual: 10, estado: true }] };
    throw new Error(`Consulta inesperada: ${q}`);
  } };
  for (const tamano of [null, 'Mediana', 'Grande']) {
    const calculo = await calcularRequeridosProduccion(client, [{ id_producto: 7, id_ft: 11, cantidad_estimada: 2, tamano }]);
    assert.equal(calculo.requeridos[0].requerido, 1);
  }
});

test('no se crean pizzas nuevas con tamaño físico', async () => {
  const client = { async query(sql) {
    if (sql.includes('FROM tb_productos p')) return { rows: [{
      id_producto: 7, nombre: 'Pizza', tipo: 'Elaborado', unidad_venta: 'und', categoria_nombre: 'Pizza',
    }] };
    throw new Error(`Consulta inesperada: ${sql}`);
  } };
  await assert.rejects(
    crearPreparacionEnTransaccion(client, { lineas: [{ id_producto: 7, cantidad: 1, tamano: 'Grande' }] }),
    (error) => error.statusCode === 400 && /sin tamaño/.test(error.message),
  );
});
