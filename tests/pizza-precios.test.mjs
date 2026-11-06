import assert from 'node:assert/strict';
import test from 'node:test';
import { pool } from '../src/config/db.js';
import AppError from '../src/errors/AppError.js';
import { completarOrdenProduccion } from '../src/services/ordenesProduccion.service.js';
import { editarProducto, cambiarEstadoProducto } from '../src/services/productos.service.js';
import { validarCompletarOrdenProduccion } from '../src/validators/ordenesProduccion.validator.js';
import { validarCreacionProducto } from '../src/validators/productos.validator.js';

function clientePizza(producto, segundo) {
  const estado = { producto: { ...producto }, segundo: segundo ? { ...segundo } : null, consultas: [] };
  const crearLinea = (id, idProducto, nombre) => ({
    id_detalle_op: id,
    id_producto: idProducto,
    id_insumo: null,
    id_ft: null,
    nombre,
    tamano: 'Mediana',
    cantidad_estimada: 2,
    cantidad_debida: 2,
    insumos_consumidos: { insumos: [] },
    cantidad_real: null,
    merma: null,
    unidad: 'und',
  });
  const lineas = [crearLinea(91, 7, 'Pizza prueba')];
  if (segundo) lineas.push(crearLinea(92, 8, 'Pizza dos'));
  const orden = {
    id_orden_produccion: 55,
    id_venta: null,
    tipo: 'Preparacion',
    estado: 'En proceso',
    stock_aplicado: false,
    historial: [],
  };
  return {
    estado,
    async query(sql, params = []) {
      const consulta = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      estado.consultas.push({ consulta, params });
      if (consulta === 'begin' || consulta === 'commit' || consulta === 'rollback') return { rows: [] };
      if (consulta.startsWith('select v.id_venta from tb_venta v')) return { rows: [] };
      if (consulta.includes('from tb_orden_produccion op')) return { rows: [{ ...orden }] };
      if (consulta.includes('from tb_detalle_orden_produccion d')) return { rows: lineas.map((l) => ({ ...l })) };
      if (consulta.startsWith('select c.nombre from tb_productos p')) return { rows: [{ nombre: 'Pizza' }] };
      if (consulta.startsWith('select precio_venta, precio_grande from tb_productos')) {
        return { rows: [{ ...(params[0] === 8 ? estado.segundo : estado.producto) }] };
      }
      if (consulta.startsWith('update tb_productos') && consulta.includes('precio_venta = $2::numeric')) {
        assert.match(consulta, /precio_grande = \$3::numeric/);
        const nuevo = { precio_venta: params[1], precio_grande: params[2] };
        if (params[0] === 8) estado.segundo = nuevo;
        else estado.producto = nuevo;
        return { rows: [], rowCount: 1 };
      }
      if (consulta.startsWith('update tb_productos')) return { rows: [], rowCount: 1 };
      if (consulta.startsWith('update tb_detalle_orden_produccion')) return { rows: [], rowCount: 1 };
      if (consulta.startsWith('update tb_orden_produccion')) {
        orden.estado = params[1];
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Consulta no esperada en prueba: ${consulta}`);
    },
    release() {},
  };
}

async function conCliente(client, accion) {
  const conectarOriginal = pool.connect;
  pool.connect = async () => client;
  try {
    return await accion();
  } finally {
    pool.connect = conectarOriginal;
  }
}

const lineasReales = [{ id_detalle_op: 91, cantidad_real: 2 }];

test('completar OP de pizza con precios los guarda en tb_productos', async () => {
  const client = clientePizza({ precio_venta: 0, precio_grande: 0 });
  const datos = validarCompletarOrdenProduccion({
    lineas: lineasReales,
    precio_mediana: 1200,
    precio_grande: 1500,
  });
  await conCliente(client, () => completarOrdenProduccion(55, datos));
  assert.deepEqual(client.estado.producto, { precio_venta: 1200, precio_grande: 1500 });
  const idxPrecio = client.estado.consultas.findIndex((c) => c.consulta.includes('precio_venta = $2::numeric'));
  const idxStock = client.estado.consultas.findIndex((c) => c.consulta.includes('stock_partes ='));
  assert.ok(idxPrecio >= 0 && idxStock > idxPrecio, 'los precios se guardan antes de sumar el stock');
});

test('completar OP de pizza con precio 0 y sin enviar precios responde 400', async () => {
  const client = clientePizza({ precio_venta: 0, precio_grande: 0 });
  await assert.rejects(
    conCliente(client, () => completarOrdenProduccion(55, validarCompletarOrdenProduccion({ lineas: lineasReales }))),
    (error) => error instanceof AppError && error.statusCode === 400,
  );
  assert.equal(client.estado.consultas.some((c) => c.consulta.includes('stock_partes =')), false);
});

test('completar OP de pizza con precio existente no exige ni cambia precios', async () => {
  const client = clientePizza({ precio_venta: 900, precio_grande: 1000 });
  await conCliente(client, () => completarOrdenProduccion(55, validarCompletarOrdenProduccion({ lineas: lineasReales })));
  assert.deepEqual(client.estado.producto, { precio_venta: 900, precio_grande: 1000 });
});

test('completar OP de pizza con precio Grande menor o igual que Mediana responde 400', async () => {
  for (const grande of [1200, 1100]) {
    const client = clientePizza({ precio_venta: 0, precio_grande: 0 });
    const datos = validarCompletarOrdenProduccion({ lineas: lineasReales, precio_mediana: 1200, precio_grande: grande });
    await assert.rejects(
      conCliente(client, () => completarOrdenProduccion(55, datos)),
      (error) => error instanceof AppError
        && error.statusCode === 400
        && /Debe ser mayor que el precio de la porción Mediana/.test(error.message),
    );
    assert.deepEqual(client.estado.producto, { precio_venta: 0, precio_grande: 0 });
    assert.equal(client.estado.consultas.some((c) => c.consulta.includes('stock_partes =')), false);
  }
});

test('completar OP con dos pizzas nuevas guarda los precios de ambas', async () => {
  const client = clientePizza({ precio_venta: 0, precio_grande: 0 }, { precio_venta: 0, precio_grande: 0 });
  const datos = validarCompletarOrdenProduccion({
    lineas: [...lineasReales, { id_detalle_op: 92, cantidad_real: 2 }],
    precios: [
      { id_producto: 7, precio_mediana: 1200, precio_grande: 1500 },
      { id_producto: 8, precio_mediana: 1000, precio_grande: 1300 },
    ],
  });
  await conCliente(client, () => completarOrdenProduccion(55, datos));
  assert.deepEqual(client.estado.producto, { precio_venta: 1200, precio_grande: 1500 });
  assert.deepEqual(client.estado.segundo, { precio_venta: 1000, precio_grande: 1300 });
});

test('completar OP con dos pizzas nuevas y falta el precio de una responde 400', async () => {
  const client = clientePizza({ precio_venta: 0, precio_grande: 0 }, { precio_venta: 0, precio_grande: 0 });
  const datos = validarCompletarOrdenProduccion({
    lineas: [...lineasReales, { id_detalle_op: 92, cantidad_real: 2 }],
    precios: [{ id_producto: 7, precio_mediana: 1200, precio_grande: 1500 }],
  });
  await assert.rejects(
    conCliente(client, () => completarOrdenProduccion(55, datos)),
    (error) => error instanceof AppError && error.statusCode === 400,
  );
  assert.equal(client.estado.consultas.some((c) => c.consulta.includes('stock_partes =')), false);
});

test('el validador de completar rechaza precios por producto repetidos o no positivos', () => {
  assert.throws(
    () => validarCompletarOrdenProduccion({
      lineas: lineasReales,
      precios: [{ id_producto: 7, precio_mediana: 1 }, { id_producto: 7, precio_grande: 1 }],
    }),
    (error) => error.statusCode === 400,
  );
  assert.throws(
    () => validarCompletarOrdenProduccion({ lineas: lineasReales, precios: [{ id_producto: 7, precio_mediana: 0 }] }),
    (error) => error.statusCode === 400,
  );
});

test('completar una orden sin precio Grande responde 400', async () => {
  const client = clientePizza({ precio_venta: 0, precio_grande: 0 });
  const datos = validarCompletarOrdenProduccion({ lineas: lineasReales, precio_mediana: 1200 });
  await assert.rejects(conCliente(client, () => completarOrdenProduccion(55, datos)),
    (error) => error.statusCode === 400);
});

test('orden solo de Medianas: precio Mediana mayor o igual al Grande guardado responde 400', async () => {
  for (const mediana of [1000, 1100]) {
    const client = clientePizza({ precio_venta: 900, precio_grande: 1000 });
    const datos = validarCompletarOrdenProduccion({ lineas: lineasReales, precio_mediana: mediana });
    await assert.rejects(
      conCliente(client, () => completarOrdenProduccion(55, datos)),
      (error) => error instanceof AppError && error.statusCode === 400,
    );
    assert.deepEqual(client.estado.producto, { precio_venta: 900, precio_grande: 1000 });
    assert.equal(client.estado.consultas.some((c) => c.consulta.includes('stock_partes =')), false);
  }
});

test('completar una preparación con cantidad real mayor que la debida responde 400', async () => {
  const client = clientePizza({ precio_venta: 900, precio_grande: 1000 });
  const datos = validarCompletarOrdenProduccion({ lineas: [{ id_detalle_op: 91, cantidad_real: 3 }] });
  await assert.rejects(
    conCliente(client, () => completarOrdenProduccion(55, datos)),
    (error) => error instanceof AppError
      && error.statusCode === 400
      && /No puede ser mayor que la cantidad que debías hacer \(2\)/.test(error.message),
  );
  assert.equal(client.estado.consultas.some((c) => c.consulta.includes('stock_partes =')), false);
});

test('editar una pizza con precio Grande menor o igual que Mediana responde 400', async () => {
  const consultas = [];
  const client = {
    async query(sql) {
      const consulta = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      consultas.push(consulta);
      if (consulta === 'begin' || consulta === 'rollback') return { rows: [] };
      if (consulta.includes('from tb_productos p join tb_categoria_productos c')) {
        return { rows: [{ id_producto: 7, id_categoria: 1, tipo: 'Elaborado', precio_venta: 900, precio_grande: 1000, categoria_nombre: 'Pizza' }] };
      }
      throw new Error(`Consulta no esperada en prueba: ${consulta}`);
    },
    release() {},
  };
  for (const grande of [1200, 1100]) {
    await assert.rejects(
      conCliente(client, () => editarProducto(7, { precio_venta: 1200, precio_grande: grande })),
      (error) => error instanceof AppError
        && error.statusCode === 400
        && /Debe ser mayor que el precio de la porción Mediana \(\$1\.200\)/.test(error.message),
    );
  }
  assert.equal(consultas.some((c) => c.startsWith('update tb_productos')), false);
});

function clienteEstadoProducto(datos = {}) {
  const producto = {
    id_producto: 7, tipo: 'Elaborado', estado: 'Descontinuado',
    categoria_nombre: 'Pizza', precio_venta: 900, precio_grande: 1000,
    stock: 0, stock_partes: 0, ...datos,
  };
  const consultas = [];
  return {
    consultas,
    async query(sql, params = []) {
      const consulta = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      consultas.push({ consulta, params });
      if (consulta === 'begin' || consulta === 'commit' || consulta === 'rollback') return { rows: [] };
      if (consulta.includes('from tb_productos p join tb_categoria_productos c')) return { rows: [{ ...producto }] };
      if (consulta.startsWith('update tb_productos set estado')) {
        producto.estado = params[1];
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Consulta no esperada en prueba: ${consulta}`);
    },
    release() {},
  };
}

test('reactivar una pizza descontinuada exige Grande mayor que Mediana, ambos > 0', async () => {
  for (const precios of [{ precio_venta: 900, precio_grande: 900 }, { precio_venta: 0, precio_grande: 0 }]) {
    const client = clienteEstadoProducto(precios);
    await assert.rejects(
      conCliente(client, () => cambiarEstadoProducto(7, 'Automático')),
      (error) => error instanceof AppError && error.statusCode === 400 && /Primero ajusta los precios en Editar/.test(error.message),
    );
    assert.equal(client.consultas.some((c) => c.consulta.startsWith('update tb_productos set estado')), false);
  }
});

test('poner disponible una pizza con stock y precios válidos guarda y devuelve Disponible', async () => {
  for (const estado of ['Descontinuado', 'No disponible']) {
    const client = clienteEstadoProducto({ estado, stock_partes: 90 });
    const resultado = await conCliente(client, () => cambiarEstadoProducto(7, 'Automático'));
    assert.equal(resultado.estado, 'Disponible');
    assert.equal(resultado.mensaje, undefined);
    assert.deepEqual(client.consultas.find((c) => c.consulta.startsWith('update tb_productos set estado')).params, [7, 'Disponible']);
  }
});

test('una pizza sin stock queda No disponible y devuelve el mensaje', async () => {
  for (const estado of ['Descontinuado', 'No disponible']) {
    const client = clienteEstadoProducto({ estado });
    const resultado = await conCliente(client, () => cambiarEstadoProducto(7, 'Automático'));
    assert.equal(resultado.estado, 'No disponible');
    assert.equal(resultado.mensaje, 'Se reactivó, pero queda No disponible porque no tiene stock');
    assert.deepEqual(client.consultas.find((c) => c.consulta.startsWith('update tb_productos set estado')).params, [7, 'No disponible']);
  }
});

test('lasañas y bebidas con stock y precio pasan a Disponible', async () => {
  for (const producto of [
    { categoria_nombre: 'Lasaña', tipo: 'Elaborado' },
    { categoria_nombre: 'Bebidas', tipo: 'Reventa' },
  ]) {
    for (const estado of ['Descontinuado', 'No disponible']) {
      const client = clienteEstadoProducto({ ...producto, estado, stock: 2 });
      const resultado = await conCliente(client, () => cambiarEstadoProducto(7, 'Automático'));
      assert.equal(resultado.estado, 'Disponible');
    }
  }
});

test('una pizza no disponible admite precio de un solo tamaño si solo ese tamaño tiene stock', async () => {
  const client = clienteEstadoProducto({
    estado: 'No disponible', stock_partes: 3, precio_grande: 0,
  });
  const resultado = await conCliente(client, () => cambiarEstadoProducto(7, 'Automático'));
  assert.equal(resultado.estado, 'Disponible');
});

test('no se pone disponible un producto con stock y precios inválidos', async () => {
  for (const producto of [
    { estado: 'No disponible', stock_partes: 18, precio_venta: 0 },
    { estado: 'No disponible', stock_partes: 32, precio_grande: 0 },
    { estado: 'No disponible', stock_partes: 18, precio_grande: 900 },
    { estado: 'No disponible', categoria_nombre: 'Lasaña', stock: 1, precio_venta: 0 },
    { estado: 'No disponible', categoria_nombre: 'Bebidas', tipo: 'Reventa', stock: 1, precio_venta: 0 },
  ]) {
    const client = clienteEstadoProducto(producto);
    await assert.rejects(
      conCliente(client, () => cambiarEstadoProducto(7, 'Automático')),
      (error) => error instanceof AppError && error.statusCode === 400,
    );
    assert.equal(client.consultas.some((c) => c.consulta.startsWith('update tb_productos set estado')), false);
  }
});

test('el validador de completar rechaza precios no positivos', () => {
  assert.throws(
    () => validarCompletarOrdenProduccion({ lineas: lineasReales, precio_mediana: 0 }),
    (error) => error.statusCode === 400,
  );
  assert.throws(
    () => validarCompletarOrdenProduccion({ lineas: lineasReales, precio_grande: -5 }),
    (error) => error.statusCode === 400,
  );
});

test('crear producto elaborado acepta precio ausente o 0 en el validador', () => {
  const base = {
    id_categoria: 1,
    nombre: 'Pizza sin precio',
    tipo: 'Elaborado',
    unidad_venta: 'und',
  };
  assert.equal(validarCreacionProducto(base).precio_venta, 0);
  assert.equal(validarCreacionProducto({ ...base, precio_venta: 0 }).precio_venta, 0);
  assert.throws(
    () => validarCreacionProducto({ ...base, precio_venta: -1 }),
    (error) => error.statusCode === 400,
  );
});
