import assert from 'node:assert/strict';
import test from 'node:test';
import { pool } from '../src/config/db.js';
import AppError from '../src/errors/AppError.js';
import {
  cancelarOrdenProduccionDeVenta,
  crearOrdenProduccion,
} from '../src/services/ordenProduccion.service.js';
import { completarOrdenProduccion } from '../src/services/ordenesProduccion.service.js';
import { validarProductosDeBase } from '../src/services/ventas.service.js';
import { validarPreciosPizza } from '../src/validators/productos.validator.js';
import { validarTamanoPizzaPreparacion } from '../src/validators/ordenesProduccion.validator.js';

function pizzaVentaClient(stockGrande) {
  const estado = { stockPartes: stockGrande * 4 };
  const linea = {
    id_producto: 7,
    cantidad: 3,
    tamano: 'Grande',
    tipo: 'Elaborado',
    unidad_venta: 'und',
    nombre: 'Pizza prueba',
    stock: 0,
    stock_partes: estado.stockPartes,
    categoria_nombre: 'Pizza',
  };
  return {
    estado,
    async query(sql, params = []) {
      const consulta = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      if (consulta.startsWith('select id_orden_produccion from tb_orden_produccion')) {
        return { rows: [] };
      }
      if (consulta.startsWith('select id_venta,')) {
        return { rows: [{ id_venta: 31, fecha_solicitada: '2026-11-05', hora_recogida: '16:00:00' }] };
      }
      if (consulta.startsWith('select dv.id_producto')) return { rows: [{ ...linea }] };
      if (consulta.startsWith('insert into tb_orden_produccion')) {
        assert.doesNotMatch(consulta, /venta_local/);
        assert.equal(params.length, 5);
        assert.match(consulta, /'en proceso', true, \$4::timestamp, 25, \$4::timestamp \+ interval '25 minutes', \$5::jsonb/);
        return { rows: [{ id_orden_produccion: 88 }] };
      }
      if (consulta.startsWith('insert into tb_detalle_orden_produccion')) return { rows: [] };
      if (consulta.startsWith('update tb_productos') && consulta.includes('stock_partes = stock_partes - $2')) {
        if (estado.stockPartes < params[1]) return { rows: [] };
        estado.stockPartes -= params[1];
        return { rows: [{ stock: 0 }] };
      }
      if (consulta.startsWith('select id_orden_produccion, estado, productos_descontados')) {
        return { rows: [{ id_orden_produccion: 88, estado: 'Pendiente', productos_descontados: true }] };
      }
      if (consulta.startsWith('select dv.id_producto, dv.cantidad, dv.tamano')) {
        return { rows: [{ ...linea, stock_partes: estado.stockPartes }] };
      }
      if (consulta.startsWith('update tb_productos') && consulta.includes('stock_partes = stock_partes + $1')) {
        estado.stockPartes += params[0];
        return { rows: [], rowCount: 1 };
      }
      if (consulta.startsWith('update tb_orden_produccion')) return { rows: [], rowCount: 1 };
      throw new Error(`Consulta no esperada en prueba: ${consulta}`);
    },
  };
}

test('completar OP antigua de Pizza Mediana por 2 suma 48 partes', async () => {
  const stock = { partes: 4 };
  const linea = {
    id_detalle_op: 91,
    id_producto: 7,
    id_insumo: null,
    id_ft: null,
    nombre: 'Pizza prueba',
    tamano: 'Mediana',
    cantidad_estimada: 2,
    cantidad_debida: 2,
    insumos_consumidos: { insumos: [] },
    cantidad_real: null,
    merma: null,
    unidad: 'und',
  };
  const orden = {
    id_orden_produccion: 55,
    id_venta: null,
    tipo: 'Preparacion',
    estado: 'En proceso',
    stock_aplicado: false,
    historial: [],
  };
  const client = {
    async query(sql, params = []) {
      const consulta = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      if (consulta === 'begin' || consulta === 'commit' || consulta === 'rollback') return { rows: [] };
      if (consulta.startsWith('select v.id_venta from tb_venta v')) return { rows: [] };
      if (consulta.includes('from tb_orden_produccion op')) return { rows: [{ ...orden }] };
      if (consulta.includes('from tb_detalle_orden_produccion d')) return { rows: [{ ...linea }] };
      if (consulta.startsWith('select c.nombre from tb_productos p')) return { rows: [{ nombre: 'Pizza' }] };
      if (consulta.startsWith('select precio_venta, precio_grande from tb_productos')) {
        return { rows: [{ precio_venta: 900, precio_grande: 1000 }] };
      }
      if (consulta.startsWith('update tb_productos') && consulta.includes('stock_partes = stock_partes + $2::int')) {
        // Sin operar parámetros sin tipo entre sí (error 42725 de PostgreSQL).
        assert.doesNotMatch(consulta, /\$\d\s*\*\s*\$\d/);
        assert.equal(params.length, 2);
        assert.deepEqual(params, [7, 48]);
        stock.partes += params[1];
        return { rows: [], rowCount: 1 };
      }
      if (consulta.startsWith('update tb_detalle_orden_produccion')) return { rows: [], rowCount: 1 };
      if (consulta.startsWith('update tb_orden_produccion')) {
        orden.estado = params[1];
        orden.stock_aplicado = true;
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Consulta no esperada en prueba: ${consulta}`);
    },
    release() {},
  };
  const conectarOriginal = pool.connect;
  pool.connect = async () => client;
  try {
    await completarOrdenProduccion(55, { lineas: [{ id_detalle_op: 91, cantidad_real: 2 }] });
  } finally {
    pool.connect = conectarOriginal;
  }
  assert.equal(stock.partes, 52);
});

test('aceptar pedido descuenta porciones Grandes y anularlo las devuelve', async () => {
  const client = pizzaVentaClient(10);
  const idOrden = await crearOrdenProduccion(client, 31);
  assert.equal(idOrden, 88);
  assert.equal(client.estado.stockPartes, 28);
  assert.equal(await cancelarOrdenProduccionDeVenta(client, 31), 88);
  assert.equal(client.estado.stockPartes, 40);
});

test('aceptar pedido rechaza con 409 si no alcanza el stock Grande', async () => {
  const client = pizzaVentaClient(2);
  await assert.rejects(
    crearOrdenProduccion(client, 31),
    (error) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 409);
      assert.match(error.message, /Solo alcanzan 2 porciones medianas o 2 grandes/);
      return true;
    },
  );
  assert.equal(client.estado.stockPartes, 8);
});

test('la venta valida el precio por porción y el stock del tamaño elegido', () => {
  const linea = { idProducto: 7, cantidad: 3, tamano: 'Grande' };
  const producto = {
    id_producto: 7,
    tipo: 'Elaborado',
    categoria_nombre: 'Pizza',
    categoria_activa: true,
    estado: 'Disponible',
    precio_venta: 900,
    precio_grande: 850,
    stock_partes: 12,
    nombre: 'Pizza prueba',
  };
  const [calculada] = validarProductosDeBase([linea], [producto]);
  assert.equal(calculada.precio, 850);
  assert.equal(calculada.subtotal, 2550);
  assert.throws(
    () => validarProductosDeBase([linea], [{ ...producto, stock_partes: 8 }]),
    (error) => error.statusCode === 409 && /Solo alcanzan/.test(error.message),
  );
});

test('la validación exige tamaño en OP de pizza y que Grande cueste más que Mediana', () => {
  assert.throws(
    () => validarTamanoPizzaPreparacion(null, 'Pizza prueba'),
    (error) => error.statusCode === 400,
  );
  assert.equal(validarTamanoPizzaPreparacion('Mediana', 'Pizza prueba'), 'Mediana');
  assert.doesNotThrow(() => validarPreciosPizza({ precio_venta: 900, precio_grande: 1000 }));
  for (const grande of [900, 850]) {
    assert.throws(
      () => validarPreciosPizza({ precio_venta: 900, precio_grande: grande }),
      (error) => error.statusCode === 400 && /Debe ser mayor que el precio de la porción Mediana \(\$900\)/.test(error.message),
    );
  }
  assert.throws(
    () => validarPreciosPizza({ precio_venta: 900, precio_grande: null }),
    (error) => error.statusCode === 400,
  );
});
