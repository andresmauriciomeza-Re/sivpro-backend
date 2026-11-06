import assert from 'node:assert/strict';
import test from 'node:test';
import { pool } from '../src/config/db.js';
import AppError from '../src/errors/AppError.js';
import { anularVenta, crearVentaCliente, crearVentaPanel } from '../src/services/ventas.service.js';
import { iniciarOrdenProduccion, completarOrdenProduccion, darBajaOrdenProduccion, listarOrdenesProduccion } from '../src/services/ordenesProduccion.service.js';
import { validarCrearVenta } from '../src/validators/ventas.validator.js';
import { validarGenerarOrdenProduccion } from '../src/validators/ordenesProduccion.validator.js';

function crearBaseVenta({ stockGrande = 10, producto = {}, productosExtra = [], fallarDetalleOrden = false } = {}) {
  const estado = {
    producto: {
      id_producto: 7,
      id_categoria: 2,
      nombre: 'Pizza prueba',
      tipo: 'Elaborado',
      precio_venta: 1000,
      precio_grande: 900,
      unidad_venta: 'und',
      stock: 0,
      stock_mediana: 12,
      stock_grande: stockGrande,
      estado: 'Disponible',
      categoria_nombre: 'Pizza',
      categoria_activa: true,
      ...producto,
    },
    venta: null,
    detalles: [],
    estadoPago: null,
    ordenesInsertadas: 0,
    orden: null,
    detallesOrden: [],
    movimientos: [],
    transacciones: [],
  };
  const productos = [estado.producto, ...productosExtra.map((p) => ({ ...p }))];
  const client = {
    async query(sql, params = []) {
      const consulta = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      if (['begin', 'commit', 'rollback'].includes(consulta)) {
        estado.transacciones.push(consulta);
        return { rows: [] };
      }
      if (consulta.startsWith('select pg_advisory_xact_lock')) return { rows: [] };
      if (consulta.includes('as es_personal')) {
        return { rows: [{ id_usuario: '10001', es_personal: false }] };
      }
      if (consulta.includes('as cliente_estado')) {
        return { rows: [{ id_usuario: '10001', id_rol: 1, rol: 'Cliente', id_cliente: 5, cliente_estado: true }] };
      }
      if (consulta.startsWith('select id_cliente, estado from tb_cliente')) {
        return { rows: [{ id_cliente: 5, estado: true }] };
      }
      if (consulta.startsWith('select p.id_producto, p.id_categoria')) {
        return { rows: productos.filter((p) => params[0].includes(p.id_producto)) };
      }
      if (consulta.startsWith('insert into tb_venta')) {
        estado.venta = {
          id_venta: 31,
          id_cliente: 5,
          fecha: params[1],
          hora_recogida: params[2],
          monto: params[3],
          estado: params[4],
        };
        return { rows: [estado.venta] };
      }
      if (consulta.startsWith('insert into tb_detalle_venta')) {
        estado.detalles.push({
          id_producto: params[1],
          cantidad: params[2],
          precio_unitario: params[3],
          sub_total: params[4],
          tamano: params[5],
        });
        return { rows: [] };
      }
      if (consulta.startsWith('insert into tb_pagos')) {
        estado.estadoPago = params[5];
        return { rows: [{ id_pago: 41 }] };
      }
      if (consulta.startsWith('insert into tb_orden_produccion')) {
        estado.ordenesInsertadas += 1;
        assert.match(consulta, /productos_descontados/);
        assert.match(consulta, /venta_local/);
        assert.match(consulta, /'pendiente', true/);
        estado.orden = {
          id_orden_produccion: 99,
          estado: 'Pendiente',
          productos_descontados: true,
          historial: JSON.parse(params[3]),
          venta_local: params[4],
        };
        return { rows: [{ id_orden_produccion: 99 }] };
      }
      if (consulta.startsWith('select id_venta,')) {
        return { rows: [{ id_venta: 31, fecha_solicitada: '2026-11-05', hora_recogida: estado.venta.hora_recogida }] };
      }
      if (consulta.startsWith('insert into tb_detalle_orden_produccion')) {
        if (fallarDetalleOrden) throw new AppError('No se pudo crear el detalle de la orden.', 409);
        estado.detallesOrden.push({ id_producto: params[1], cantidad: params[2], unidad: params[3], nombre: params[4], tamano: params[5] });
        return { rows: [] };
      }
      if (consulta.startsWith('select dv.id_producto, dv.cantidad, dv.tamano, p.tipo') && consulta.includes('p.stock')) {
        return { rows: estado.detalles.map((detalle) => ({ ...productos.find((p) => p.id_producto === detalle.id_producto), ...detalle })) };
      }
      if (consulta.startsWith('update tb_productos') && consulta.includes('stock_grande = stock_grande - $1')) {
        if (estado.producto.stock_grande < params[0]) return { rows: [] };
        estado.producto.stock_grande -= params[0];
        estado.movimientos.push(['descuento_grande', params[0]]);
        return { rows: [{ id_producto: params[1] }] };
      }
      if (consulta.startsWith('update tb_productos') && consulta.includes('stock_mediana = stock_mediana - $1')) {
        if (estado.producto.stock_mediana < params[0]) return { rows: [] };
        estado.producto.stock_mediana -= params[0];
        estado.movimientos.push(['descuento_mediana', params[0]]);
        return { rows: [{ id_producto: params[1] }] };
      }
      if (consulta.startsWith('select v.id_venta, v.fecha, v.monto, v.estado')) {
        return {
          rows: estado.venta
            ? [{ ...estado.venta, transcurridos: 60 }]
            : [],
        };
      }
      if (consulta.startsWith('select id_orden_produccion from tb_orden_produccion')) return { rows: estado.orden ? [estado.orden] : [] };
      if (consulta.startsWith('select id_orden_produccion, historial from tb_orden_produccion')) return { rows: estado.orden ? [estado.orden] : [] };
      if (consulta.startsWith('select id_orden_produccion, estado, productos_descontados, historial from tb_orden_produccion')) return { rows: estado.orden ? [estado.orden] : [] };
      if (consulta.startsWith('update tb_orden_produccion')) {
        estado.orden.estado = 'Cancelada';
        if (params[1]) estado.orden.historial = JSON.parse(params[1]);
        return { rows: [], rowCount: 1 };
      }
      if (consulta.startsWith('select dv.id_producto, dv.cantidad, dv.tamano, p.tipo')) {
        return {
          rows: estado.detalles.map((detalle) => ({
            ...productos.find((p) => p.id_producto === detalle.id_producto),
            ...detalle,
          })),
        };
      }
      if (consulta.startsWith('update tb_productos') && consulta.includes('stock_grande = stock_grande + $1')) {
        estado.producto.stock_grande += params[0];
        estado.movimientos.push(['devolucion_grande', params[0]]);
        return { rows: [] };
      }
      if (consulta.startsWith('update tb_productos') && consulta.includes('stock_mediana = stock_mediana + $1')) {
        estado.producto.stock_mediana += params[0];
        estado.movimientos.push(['devolucion_mediana', params[0]]);
        return { rows: [] };
      }
      if (consulta.startsWith('update tb_productos set stock = stock - $1::int')) {
        const productoActual = productos.find((p) => p.id_producto === params[1]);
        if (productoActual.stock < params[0]) return { rows: [] };
        productoActual.stock -= params[0];
        estado.movimientos.push(['descuento_stock', params[0]]);
        return { rows: [{ id_producto: params[1] }] };
      }
      if (consulta.startsWith('update tb_productos set stock = stock + $1::int')) {
        const productoActual = productos.find((p) => p.id_producto === params[1]);
        productoActual.stock += params[0];
        estado.movimientos.push(['devolucion_stock', params[0]]);
        return { rows: [] };
      }
      if (consulta.startsWith('update tb_pagos set estado =')) {
        estado.estadoPago = 'Rechazado';
        return { rows: [] };
      }
      if (consulta.startsWith('update tb_venta set estado =')) {
        estado.venta = { ...estado.venta, estado: params[0] };
        return { rows: [estado.venta] };
      }
      throw new Error(`Consulta no esperada en prueba: ${consulta}`);
    },
    release() {},
  };
  return { estado, client };
}

async function conBaseSimulada(base, callback) {
  const conectarOriginal = pool.connect;
  const queryOriginal = pool.query;
  pool.connect = async () => base.client;
  pool.query = async () => ({ rows: [] });
  try {
    return await callback();
  } finally {
    pool.connect = conectarOriginal;
    pool.query = queryOriginal;
  }
}

const clientePanel = {
  tipoDocumento: 'CC',
  numeroDocumento: '10001',
  nombre: 'Cliente prueba',
};
const lineaGrande = { idProducto: 7, cantidad: 3, tamano: 'Grande' };
const pagoLocal = { tipo: 'Efectivo', comprobante: null };

test('venta del panel completa, verifica el pago y crea OP sin doble descuento', async () => {
  const base = crearBaseVenta();
  const venta = await conBaseSimulada(base, () => crearVentaPanel(clientePanel, {
    horaRecogida: null,
    lineas: [lineaGrande],
    pago: pagoLocal,
  }));

  assert.equal(venta.estado, 'Completado');
  assert.equal(base.estado.estadoPago, 'Verificado');
  assert.equal(base.estado.producto.stock_grande, 7);
  assert.equal(base.estado.ordenesInsertadas, 1);
  assert.equal(base.estado.orden.estado, 'Pendiente');
  assert.equal(base.estado.orden.productos_descontados, true);
  assert.equal(base.estado.orden.venta_local, true);
  assert.deepEqual(base.estado.detallesOrden, [{ id_producto: 7, cantidad: 3, unidad: 'porciones', nombre: 'Pizza prueba', tamano: 'Grande' }]);
  assert.deepEqual(base.estado.movimientos, [['descuento_grande', 3]]);
});

test('venta del panel solo de bebidas no crea OP', async () => {
  const base = crearBaseVenta({ producto: {
    nombre: 'Bebida', tipo: 'Reventa', categoria_nombre: 'Bebidas', stock: 5,
  } });
  const venta = await conBaseSimulada(base, () => crearVentaPanel(clientePanel, {
    horaRecogida: null, lineas: [{ idProducto: 7, cantidad: 2, tamano: null }], pago: pagoLocal,
  }));
  assert.equal(venta.estado, 'Completado');
  assert.equal(base.estado.estadoPago, 'Verificado');
  assert.equal(base.estado.producto.stock, 3);
  assert.equal(base.estado.ordenesInsertadas, 0);
});

test('si falla la creación de la OP se revierte la transacción de la venta', async () => {
  const base = crearBaseVenta({ fallarDetalleOrden: true });
  await assert.rejects(
    conBaseSimulada(base, () => crearVentaPanel(clientePanel, {
      horaRecogida: null, lineas: [lineaGrande], pago: pagoLocal,
    })),
    (error) => error instanceof AppError && error.statusCode === 409,
  );
  assert.deepEqual(base.estado.transacciones, ['begin', 'rollback']);
});

test('venta del panel responde 409 con stock insuficiente para el tamaño elegido', async () => {
  const base = crearBaseVenta({ stockGrande: 2 });
  const entrada = validarCrearVenta({
    productos: [
      { id_producto: 7, cantidad: 2, tamano: 'Grande' },
      { id_producto: 7, cantidad: 2, tamano: 'Grande' },
    ],
    pago: pagoLocal,
  }, { panel: true });
  await assert.rejects(
    conBaseSimulada(base, () => crearVentaPanel(clientePanel, entrada)),
    (error) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 409);
      assert.match(error.message, /Solo hay 2 porciones de Pizza prueba Grande\./);
      assert.equal(error.faltantes[0].unidad, 'porciones');
      return true;
    },
  );
  assert.equal(base.estado.venta, null);
  assert.equal(base.estado.producto.stock_grande, 2);
});

test('anular una venta del panel dentro de 10 minutos devuelve las porciones', async () => {
  const base = crearBaseVenta();
  await conBaseSimulada(base, async () => {
    await crearVentaPanel(clientePanel, {
      horaRecogida: null,
      lineas: [lineaGrande],
      pago: pagoLocal,
    });
    const anulada = await anularVenta(31, { motivo: 'Error al registrar el pedido' });
    assert.equal(anulada.estado, 'Anulado');
    assert.equal(anulada.id_orden_produccion_cancelada, 99);
  });
  assert.equal(base.estado.producto.stock_grande, 10);
  assert.equal(base.estado.estadoPago, 'Rechazado');
  assert.equal(base.estado.orden.estado, 'Cancelada');
  assert.equal(base.estado.orden.historial.at(-1).a, 'Cancelada');
  assert.deepEqual(base.estado.movimientos, [['descuento_grande', 3], ['devolucion_grande', 3]]);
});

test('venta del panel crea una OP con ambos tamaños y lasaña, sin bebidas', async () => {
  const lasana = {
    id_producto: 8, nombre: 'Lasaña', tipo: 'Elaborado', categoria_nombre: 'Lasaña',
    categoria_activa: true, estado: 'Disponible', precio_venta: 5000, unidad_venta: 'und', stock: 4,
  };
  const bebida = {
    id_producto: 9, nombre: 'Bebida', tipo: 'Reventa', categoria_nombre: 'Bebidas',
    categoria_activa: true, estado: 'Disponible', precio_venta: 2000, unidad_venta: 'und', stock: 3,
  };
  const base = crearBaseVenta({ productosExtra: [lasana, bebida] });
  await conBaseSimulada(base, async () => {
    await crearVentaPanel(clientePanel, {
      horaRecogida: null,
      lineas: [
        { idProducto: 7, cantidad: 2, tamano: 'Mediana' },
        { idProducto: 7, cantidad: 3, tamano: 'Grande' },
        { idProducto: 8, cantidad: 1, tamano: 'Normal' },
        { idProducto: 9, cantidad: 1, tamano: null },
      ],
      pago: pagoLocal,
    });
    assert.deepEqual(base.estado.detallesOrden.map(({ id_producto, cantidad, tamano }) => [id_producto, cantidad, tamano]), [
      [7, 2, 'Mediana'], [7, 3, 'Grande'], [8, 1, 'Normal'],
    ]);
    assert.deepEqual(base.estado.movimientos, [
      ['descuento_mediana', 2], ['descuento_grande', 3], ['descuento_stock', 1], ['descuento_stock', 1],
    ]);
    await anularVenta(31, { motivo: 'Error al registrar el pedido' });
  });
  assert.equal(base.estado.orden.estado, 'Cancelada');
  assert.deepEqual(base.estado.movimientos.slice(4), [
    ['devolucion_mediana', 2], ['devolucion_grande', 3], ['devolucion_stock', 1], ['devolucion_stock', 1],
  ]);
});

test('anular venta del panel conserva la OP completada o ya cancelada y devuelve stock una vez', async () => {
  for (const estadoOrden of ['Completada', 'Cancelada']) {
    const base = crearBaseVenta();
    await conBaseSimulada(base, async () => {
      await crearVentaPanel(clientePanel, { horaRecogida: null, lineas: [lineaGrande], pago: pagoLocal });
      base.estado.orden.estado = estadoOrden;
      const resultado = await anularVenta(31, { motivo: 'Error al registrar el pedido' });
      assert.equal(resultado.estado, 'Anulado');
      assert.equal(resultado.id_orden_produccion_cancelada, estadoOrden === 'Cancelada' ? 99 : null);
    });
    assert.equal(base.estado.orden.estado, estadoOrden);
    assert.deepEqual(base.estado.movimientos, [['descuento_grande', 3], ['devolucion_grande', 3]]);
  }
});

test('una venta completada de tienda con OP no se trata como venta del panel', async () => {
  const base = crearBaseVenta();
  base.estado.venta = { id_venta: 31, estado: 'Completado', monto: 2700 };
  base.estado.orden = { id_orden_produccion: 99, estado: 'Completada', historial: [] };
  await assert.rejects(
    conBaseSimulada(base, () => anularVenta(31, { motivo: 'Error al registrar el pedido' })),
    (error) => error instanceof AppError && error.statusCode === 409,
  );
  assert.deepEqual(base.estado.movimientos, []);
});

test('iniciar y completar o dar de baja la OP del panel no modifica venta ni inventario', async () => {
  for (const accion of ['completar', 'baja']) {
    const orden = {
      id_orden_produccion: 99, id_venta: 31, tipo: 'Pedido', estado: 'Pendiente',
      fecha_solicitada: '2026-11-05', hora_solicitada: '12:00:00',
      historial: [{ de: null, a: 'Pendiente', origen: 'venta_panel' }],
      productos_descontados: true, insumos_requeridos: [], venta_local: true,
    };
    const linea = {
      id_detalle_op: 44, id_producto: 7, id_insumo: null, id_ft: null,
      nombre: 'Pizza prueba', tamano: 'Grande', cantidad_estimada: 3, unidad: 'porciones',
    };
    const consultas = [];
    const base = {
      client: {
        async query(sql, params = []) {
          const consulta = sql.replace(/\s+/g, ' ').trim().toLowerCase();
          consultas.push(consulta);
          if (['begin', 'commit', 'rollback'].includes(consulta)) return { rows: [] };
          if (consulta.includes('from tb_orden_produccion op')) return { rows: [{ ...orden }] };
          if (consulta.includes('from tb_detalle_orden_produccion d')) return { rows: [{ ...linea }] };
          if (consulta.includes('as ahora_bogota')) {
            return { rows: [{ ahora_bogota: '2026-11-05T12:00:00', recogida_bogota: '2026-11-05T12:00:00' }] };
          }
          if (consulta.includes('as no_pasada')) return { rows: [{ no_pasada: true }] };
          if (consulta.startsWith('update tb_orden_produccion')) {
            orden.estado = params[1];
            orden.historial = JSON.parse(params[consulta.includes('fecha_entrega_estimada') ? 4 : params.length - 1]);
            return { rows: [], rowCount: 1 };
          }
          throw new Error(`Consulta no esperada en prueba: ${consulta}`);
        },
        release() {},
      },
    };
    await conBaseSimulada(base, async () => {
      await iniciarOrdenProduccion(99, { fecha_entrega_estimada: '2026-11-05T12:10:00' });
      if (accion === 'completar') await completarOrdenProduccion(99, { lineas: null });
      else await darBajaOrdenProduccion(99, { motivo: 'Otro', descripcion: 'Prueba' });
    });
    assert.equal(orden.estado, accion === 'completar' ? 'Completada' : 'Cancelada');
    assert.equal(consultas.some((c) => c.startsWith('update tb_venta') || c.startsWith('update tb_productos') || c.includes('tb_insumo')), false);
  }
});

test('inicio local usa hora del servidor sin imponer la hora ficticia de recogida', async () => {
  for (const legacy of [false, true]) {
  const orden = {
    id_orden_produccion: 99, id_venta: 31, tipo: 'Pedido', estado: 'Pendiente', venta_local: !legacy,
    fecha_solicitada: '2026-11-05', hora_solicitada: '12:00:00',
    historial: legacy ? [{ origen: 'venta_panel' }] : [], insumos_requeridos: [],
  };
  const consultas = [];
  const base = { client: {
    async query(sql, params = []) {
      const consulta = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      consultas.push({ consulta, params });
      if (['begin', 'commit', 'rollback'].includes(consulta)) return { rows: [] };
      if (consulta.includes('from tb_orden_produccion op')) return { rows: [{ ...orden }] };
      if (consulta.includes('from tb_detalle_orden_produccion d')) return { rows: [] };
      if (consulta.startsWith('update tb_orden_produccion')) {
        orden.estado = params[1];
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Consulta no esperada en prueba: ${consulta}`);
    },
    release() {},
  } };
  const datos = validarGenerarOrdenProduccion({
    fecha_entrega_estimada: '2026-11-05T12:00',
    fecha_limite_automatica: true,
  });
  const resultado = await conBaseSimulada(base, () => iniciarOrdenProduccion(99, datos));
  assert.equal(resultado.venta_local, true);
  const update = consultas.find(({ consulta }) => consulta.startsWith('update tb_orden_produccion'));
  assert.match(update.consulta, /case when \$6::boolean then current_timestamp at time zone 'america\/bogota'/);
  assert.equal(update.params[5], true);
  assert.equal(consultas.some(({ consulta }) => consulta.includes('as ahora_bogota')), false);
  }
});

test('inicio local con fecha editada rechaza el pasado; la opción automática no aplica a tienda', async () => {
  const orden = {
    id_orden_produccion: 99, id_venta: 31, tipo: 'Pedido', estado: 'Pendiente', venta_local: true,
    historial: [], insumos_requeridos: [],
  };
  const base = { client: {
    async query(sql) {
      const consulta = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      if (['begin', 'rollback'].includes(consulta)) return { rows: [] };
      if (consulta.includes('from tb_orden_produccion op')) return { rows: [{ ...orden }] };
      if (consulta.includes('from tb_detalle_orden_produccion d')) return { rows: [] };
      if (consulta.includes('as no_pasada')) return { rows: [{ no_pasada: false }] };
      throw new Error(`Consulta no esperada en prueba: ${consulta}`);
    },
    release() {},
  } };
  await assert.rejects(
    conBaseSimulada(base, () => iniciarOrdenProduccion(99, { fecha_entrega_estimada: '2026-11-05 11:59:00' })),
    (error) => error instanceof AppError && error.statusCode === 400,
  );
  orden.venta_local = false;
  await assert.rejects(
    conBaseSimulada(base, () => iniciarOrdenProduccion(99, { fecha_entrega_estimada: '2026-11-05 12:00:00', fecha_limite_automatica: true })),
    (error) => error instanceof AppError && error.statusCode === 400,
  );
  assert.throws(
    () => validarGenerarOrdenProduccion({ fecha_entrega_estimada: '2026-11-05T12:00', fecha_limite_automatica: 'true' }),
    (error) => error instanceof AppError && error.statusCode === 400,
  );
});

test('inicio local conserva una fecha editada sin limitarla por la recogida ficticia', async () => {
  const orden = {
    id_orden_produccion: 99, id_venta: 31, tipo: 'Pedido', estado: 'Pendiente',
    venta_local: true, historial: [], insumos_requeridos: [],
  };
  let update;
  const base = { client: {
    async query(sql, params = []) {
      const consulta = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      if (['begin', 'commit', 'rollback'].includes(consulta)) return { rows: [] };
      if (consulta.includes('from tb_orden_produccion op')) return { rows: [{ ...orden }] };
      if (consulta.includes('from tb_detalle_orden_produccion d')) return { rows: [] };
      if (consulta.includes('as no_pasada')) return { rows: [{ no_pasada: true }] };
      if (consulta.startsWith('update tb_orden_produccion')) {
        update = params;
        orden.estado = params[1];
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Consulta no esperada en prueba: ${consulta}`);
    },
    release() {},
  } };
  await conBaseSimulada(base, () => iniciarOrdenProduccion(99, validarGenerarOrdenProduccion({
    fecha_entrega_estimada: '2026-11-05T12:30',
    fecha_limite_automatica: false,
  })));
  assert.equal(update[2], '2026-11-05 12:30:00');
  assert.equal(update[5], false);
});

test('listado de órdenes expone venta_local', async () => {
  const queryOriginal = pool.query;
  pool.query = async (sql) => {
    const consulta = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    if (consulta.includes('from tb_orden_produccion op')) {
      assert.match(consulta, /op\.venta_local/);
      return { rows: [
        { id_orden_produccion: 99, id_venta: 31, tipo: 'Pedido', venta_local: true, historial: [], insumos_requeridos: [] },
        { id_orden_produccion: 100, id_venta: 32, tipo: 'Pedido', venta_local: false, historial: [{ origen: 'venta_panel' }], insumos_requeridos: [] },
        { id_orden_produccion: 101, id_venta: 33, tipo: 'Pedido', venta_local: false, historial: [], insumos_requeridos: [] },
      ] };
    }
    if (consulta.includes('from tb_detalle_orden_produccion d')) return { rows: [] };
    throw new Error(`Consulta no esperada en prueba: ${consulta}`);
  };
  try {
    const ordenes = await listarOrdenesProduccion({});
    assert.equal(ordenes[0].venta_local, true);
    assert.equal(ordenes[1].venta_local, true);
    assert.equal(ordenes[2].venta_local, false);
  } finally {
    pool.query = queryOriginal;
  }
});

test('la venta de tienda continúa Por verificar y no descuenta stock', async () => {
  const base = crearBaseVenta();
  const venta = await conBaseSimulada(base, () => crearVentaCliente(10001, {
    horaRecogida: null,
    lineas: [lineaGrande],
    pago: { tipo: 'Nequi', comprobante: 'comprobante' },
  }));

  assert.equal(venta.estado, 'Por verificar');
  assert.equal(base.estado.estadoPago, 'Pendiente');
  assert.equal(base.estado.producto.stock_grande, 10);
  assert.equal(base.estado.ordenesInsertadas, 0);
});
