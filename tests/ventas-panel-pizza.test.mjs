import assert from 'node:assert/strict';
import test from 'node:test';
import { pool } from '../src/config/db.js';
import AppError from '../src/errors/AppError.js';
import { anularVenta, avanzarVentasCompletadas, cancelarVentaCliente, crearVentaCliente, crearVentaPanel } from '../src/services/ventas.service.js';
import { iniciarOrdenProduccion, completarOrdenProduccion, darBajaOrdenProduccion, listarOrdenesProduccion, obtenerOrdenProduccion } from '../src/services/ordenesProduccion.service.js';
import { validarCrearVenta } from '../src/validators/ventas.validator.js';
import { validarGenerarOrdenProduccion } from '../src/validators/ordenesProduccion.validator.js';

function crearBaseVenta({ stockGrande = 10, producto = {}, productosExtra = [], fallarDetalleOrden = false, transcurridos = 60 } = {}) {
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
      stock_partes: stockGrande * 4,
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
        assert.match(consulta, /fecha_estado, venta_local/);
        assert.match(consulta, /\$6::boolean/);
        estado.venta = {
          id_venta: 31,
          id_cliente: 5,
          fecha: params[1],
          hora_recogida: params[2],
          monto: params[3],
          estado: params[4],
          fecha_estado: params[1],
          venta_local: params[5],
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
        assert.doesNotMatch(consulta, /venta_local/);
        assert.equal(params.length, 5);
        assert.match(consulta, /'en proceso', true, \$4::timestamp, 25, \$4::timestamp \+ interval '25 minutes', \$5::jsonb/);
        estado.orden = {
          id_orden_produccion: 99,
          estado: 'En proceso',
          productos_descontados: true,
          fecha_en_proceso: params[3],
          tiempo_preparacion_min: 25,
          historial: JSON.parse(params[4]),
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
      if (consulta.startsWith('update tb_productos') && consulta.includes('stock_partes = stock_partes - $1')) {
        if (estado.producto.stock_partes < params[0]) return { rows: [] };
        estado.producto.stock_partes -= params[0];
        estado.movimientos.push(['descuento_partes', params[0]]);
        return { rows: [{ id_producto: params[1] }] };
      }
      if (consulta.startsWith('select v.id_venta, v.fecha, v.monto, v.estado')) {
        return {
          rows: estado.venta
            ? [{ ...estado.venta, transcurridos }]
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
      if (consulta.startsWith('update tb_productos') && consulta.includes('stock_partes = stock_partes + $1')) {
        estado.producto.stock_partes += params[0];
        estado.movimientos.push(['devolucion_partes', params[0]]);
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

test('venta de una mediana de 24 partes deja 21 y la anulación las devuelve', async () => {
  const base = crearBaseVenta({ stockGrande: 6 });
  await conBaseSimulada(base, async () => {
    await crearVentaPanel(clientePanel, {
      horaRecogida: null, lineas: [{ idProducto: 7, cantidad: 1, tamano: 'Mediana' }], pago: pagoLocal,
    });
    assert.equal(base.estado.producto.stock_partes, 21);
    assert.equal(Math.floor(base.estado.producto.stock_partes / 3), 7);
    assert.equal(Math.floor(base.estado.producto.stock_partes / 4), 5);
    await anularVenta(31, { motivo: 'Error al registrar el pedido' });
    assert.equal(base.estado.producto.stock_partes, 24);
  });
  assert.deepEqual(base.estado.movimientos, [['descuento_partes', 3], ['devolucion_partes', 3]]);
});

test('venta del panel queda por entregar, verifica el pago y crea OP sin doble descuento', async () => {
  const base = crearBaseVenta();
  const venta = await conBaseSimulada(base, () => crearVentaPanel(clientePanel, {
    horaRecogida: null,
    lineas: [lineaGrande],
    pago: pagoLocal,
  }));

  assert.equal(venta.estado, 'Por entregar');
  assert.equal(venta.venta_local, true);
  assert.equal(base.estado.estadoPago, 'Verificado');
  assert.equal(base.estado.producto.stock_partes, 28);
  assert.equal(base.estado.ordenesInsertadas, 1);
  assert.equal(base.estado.orden.estado, 'En proceso');
  assert.equal(base.estado.orden.tiempo_preparacion_min, 25);
  assert.ok(base.estado.orden.fecha_en_proceso);
  assert.deepEqual(base.estado.orden.historial[0], {
    de: null, a: 'En proceso', fechaHora: base.estado.orden.fecha_en_proceso, origen: 'venta_panel',
  });
  assert.equal(base.estado.orden.productos_descontados, true);
  assert.equal(base.estado.orden.historial[0].origen, 'venta_panel');
  assert.deepEqual(base.estado.detallesOrden, [{ id_producto: 7, cantidad: 3, unidad: 'porciones', nombre: 'Pizza prueba', tamano: 'Grande' }]);
  assert.deepEqual(base.estado.movimientos, [['descuento_partes', 12]]);
});

test('venta del panel solo de bebidas no crea OP', async () => {
  const base = crearBaseVenta({ producto: {
    nombre: 'Bebida', tipo: 'Reventa', categoria_nombre: 'Bebidas', stock: 5,
  } });
  const venta = await conBaseSimulada(base, () => crearVentaPanel(clientePanel, {
    horaRecogida: null, lineas: [{ idProducto: 7, cantidad: 2, tamano: null }], pago: pagoLocal,
  }));
  assert.equal(venta.estado, 'Por entregar');
  assert.equal(venta.venta_local, true);
  assert.equal(base.estado.estadoPago, 'Verificado');
  assert.equal(base.estado.producto.stock, 3);
  assert.equal(base.estado.ordenesInsertadas, 0);
});

test('anular venta local solo de bebidas devuelve el stock sin OP', async () => {
  const base = crearBaseVenta({ producto: {
    nombre: 'Bebida', tipo: 'Reventa', categoria_nombre: 'Bebidas', stock: 5,
  } });
  await conBaseSimulada(base, async () => {
    await crearVentaPanel(clientePanel, {
      horaRecogida: null, lineas: [{ idProducto: 7, cantidad: 2, tamano: null }], pago: pagoLocal,
    });
    const anulada = await anularVenta(31, { motivo: 'Error al registrar el pedido' });
    assert.equal(anulada.id_orden_produccion_cancelada, null);
  });
  assert.equal(base.estado.producto.stock, 5);
  assert.deepEqual(base.estado.movimientos, [['descuento_stock', 2], ['devolucion_stock', 2]]);
});

test('cancelación de cliente de venta local devuelve el stock una sola vez', async () => {
  const base = crearBaseVenta();
  await conBaseSimulada(base, async () => {
    await crearVentaPanel(clientePanel, { horaRecogida: null, lineas: [lineaGrande], pago: pagoLocal });
    const cancelada = await cancelarVentaCliente(31, '10001');
    assert.equal(cancelada.estado, 'Anulado');
  });
  assert.equal(base.estado.orden.estado, 'Cancelada');
  assert.deepEqual(base.estado.movimientos, [['descuento_partes', 12], ['devolucion_partes', 12]]);
});

test('avance local usa 25 minutos u OP completada, sin aplicar esas reglas a tienda', async () => {
  const ventas = [
    { id_venta: 1, venta_local: true, minutos: 25, estado: 'Por entregar' },
    { id_venta: 2, venta_local: true, minutos: 26, estado: 'Por entregar' },
    { id_venta: 3, venta_local: true, minutos: 24.99, estado: 'Por entregar' },
    { id_venta: 4, venta_local: false, minutos: 26, estado: 'Por entregar' },
    { id_venta: 5, venta_local: true, minutos: 26, estado: 'Anulado' },
    { id_venta: 6, venta_local: true, minutos: 1, estado: 'Por entregar', opCompletada: true },
    { id_venta: 7, venta_local: false, minutos: 1, estado: 'Por entregar', opCompletada: true },
  ];
  const original = pool.query;
  pool.query = async (sql, params) => {
    const consulta = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    if (!consulta.startsWith('update tb_venta')) return { rows: [] };
    assert.match(consulta, /venta_local = true and \(\s*fecha_estado \+ interval '25 minutes' <= now\(\) at time zone \$2::text\s*or exists \( select 1 from tb_orden_produccion op where op\.id_venta = tb_venta\.id_venta and op\.tipo = 'pedido' and op\.estado = 'completada' \)\s*\)\)/);
    assert.match(consulta, /venta_local = false and hora_recogida is not null/);
    assert.match(consulta, /op\.estado = 'completada'/);
    assert.match(consulta, /set estado = \$1::text, fecha_estado = now\(\) at time zone \$2::text/);
    assert.deepEqual(params, ['Completado', 'America/Bogota', 'Por entregar']);
    const actualizadas = ventas.filter((venta) => venta.estado === params[2] && venta.venta_local && (venta.minutos >= 25 || venta.opCompletada));
    for (const venta of actualizadas) venta.estado = params[0];
    return { rows: actualizadas.map(({ id_venta }) => ({ id_venta })), rowCount: actualizadas.length };
  };
  try {
    assert.equal(await avanzarVentasCompletadas(), 3);
    assert.deepEqual(ventas.map(({ estado }) => estado), [
      'Completado', 'Completado', 'Por entregar', 'Por entregar', 'Anulado', 'Completado', 'Por entregar',
    ]);
  } finally {
    pool.query = original;
  }
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
      assert.match(error.message, /Solo alcanzan 2 porciones medianas o 2 grandes de Pizza prueba/);
      return true;
    },
  );
  assert.equal(base.estado.venta, null);
  assert.equal(base.estado.producto.stock_partes, 8);
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
  assert.equal(base.estado.producto.stock_partes, 40);
  assert.equal(base.estado.estadoPago, 'Rechazado');
  assert.equal(base.estado.orden.estado, 'Cancelada');
  assert.equal(base.estado.orden.historial.at(-1).a, 'Cancelada');
  assert.deepEqual(base.estado.movimientos, [['descuento_partes', 12], ['devolucion_partes', 12]]);
  await assert.rejects(
    conBaseSimulada(base, () => anularVenta(31, { motivo: 'Error al registrar el pedido' })),
    (error) => error instanceof AppError && error.statusCode === 409,
  );
  assert.deepEqual(base.estado.movimientos, [['descuento_partes', 12], ['devolucion_partes', 12]]);
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
      ['descuento_partes', 6], ['descuento_partes', 12], ['descuento_stock', 1], ['descuento_stock', 1],
    ]);
    await anularVenta(31, { motivo: 'Error al registrar el pedido' });
  });
  assert.equal(base.estado.orden.estado, 'Cancelada');
  assert.deepEqual(base.estado.movimientos.slice(4), [
    ['devolucion_partes', 6], ['devolucion_partes', 12], ['devolucion_stock', 1], ['devolucion_stock', 1],
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
    assert.deepEqual(base.estado.movimientos, [['descuento_partes', 12], ['devolucion_partes', 12]]);
  }
});

test('el cliente puede cancelar dentro de los 10 minutos una venta local marcada lista', async () => {
  const base = crearBaseVenta();
  await conBaseSimulada(base, async () => {
    await crearVentaPanel(clientePanel, { horaRecogida: null, lineas: [lineaGrande], pago: pagoLocal });
    base.estado.orden.estado = 'Completada';
    base.estado.venta.estado = 'Completado';
    const resultado = await cancelarVentaCliente(31, '10001');
    assert.equal(resultado.estado, 'Anulado');
  });
  assert.equal(base.estado.orden.estado, 'Completada');
  assert.deepEqual(base.estado.movimientos, [['descuento_partes', 12], ['devolucion_partes', 12]]);
});

test('el cliente no puede cancelar una venta local lista después de los 10 minutos', async () => {
  const base = crearBaseVenta({ transcurridos: 600 });
  await conBaseSimulada(base, async () => {
    await crearVentaPanel(clientePanel, { horaRecogida: null, lineas: [lineaGrande], pago: pagoLocal });
    base.estado.orden.estado = 'Completada';
    base.estado.venta.estado = 'Completado';
    await assert.rejects(cancelarVentaCliente(31, '10001'), (error) => error.statusCode === 409 && /10 minutos/.test(error.message));
  });
  assert.equal(base.estado.venta.estado, 'Completado');
  assert.deepEqual(base.estado.movimientos, [['descuento_partes', 12]]);
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

test('dar de baja un pedido no cambia la venta', async () => {
  for (const [accion, local, estadoInicial] of [
    ['baja', true, 'Por entregar'],
  ]) {
    const orden = {
      id_orden_produccion: 99, id_venta: 31, tipo: 'Pedido', estado: 'En proceso',
      fecha_solicitada: '2026-11-05', hora_solicitada: '12:00:00',
      historial: [{ de: null, a: 'En proceso', ...(local ? { origen: 'venta_panel' } : {}) }],
      productos_descontados: true, insumos_requeridos: [], es_venta_local: local,
    };
    const lineas = [{
      id_detalle_op: 44, id_producto: 7, id_insumo: null, id_ft: null,
      nombre: 'Pizza prueba', tamano: 'Grande', cantidad_estimada: 3, cantidad_real: null, unidad: 'porciones',
    }, {
      id_detalle_op: 45, id_producto: 8, id_insumo: null, id_ft: null,
      nombre: 'Lasaña', tamano: 'Normal', cantidad_estimada: 2, cantidad_real: null, unidad: 'und',
    }];
    const venta = { estado: estadoInicial };
    const consultas = [];
    const base = {
      client: {
        async query(sql, params = []) {
          const consulta = sql.replace(/\s+/g, ' ').trim().toLowerCase();
          consultas.push(consulta);
          if (['begin', 'commit', 'rollback'].includes(consulta)) return { rows: [] };
          if (consulta.startsWith('select v.id_venta from tb_venta v')) {
            assert.match(consulta, /op\.id_orden_produccion = \$1::int.*v\.venta_local = true for update of v/);
            return { rows: local ? [{ id_venta: 31 }] : [] };
          }
          if (consulta.includes('from tb_orden_produccion op')) return { rows: [{ ...orden }] };
          if (consulta.includes('from tb_detalle_orden_produccion d')) return { rows: lineas.map((linea) => ({ ...linea })) };
          if (consulta.startsWith('update tb_detalle_orden_produccion')) {
            assert.match(consulta, /set cantidad_real = cantidad_estimada where id_orden_produccion = \$1::int/);
            for (const linea of lineas) linea.cantidad_real = linea.cantidad_estimada;
            return { rows: [], rowCount: lineas.length };
          }
          if (consulta.startsWith('update tb_venta')) {
            assert.match(consulta, /fecha_estado = now\(\) at time zone 'america\/bogota'/);
            assert.match(consulta, /id_venta = \$1::int and venta_local = true and estado = \$3::text/);
            assert.deepEqual(params, [31, 'Completado', 'Por entregar']);
            if (venta.estado === params[2]) venta.estado = params[1];
            return { rows: [] };
          }
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
    const resultado = await conBaseSimulada(base, () => darBajaOrdenProduccion(99, { motivo: 'Otro', descripcion: 'Prueba' }));
    assert.deepEqual(resultado.lineas.map((linea) => linea.cantidad_real), [null, null]);
    assert.equal(orden.estado, 'Cancelada');
    assert.equal(venta.estado, estadoInicial);
    assert.equal(consultas.some((c) => c.startsWith('update tb_venta')), false);
    assert.equal(consultas.some((c) => c.startsWith('update tb_productos') || c.includes('tb_insumo')), false);
  }
});

test('completar un pedido fuera de proceso revierte la transacción', async () => {
  const consultas = [];
  const base = { client: {
    async query(sql) {
      const consulta = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      consultas.push(consulta);
      if (['begin', 'rollback'].includes(consulta)) return { rows: [] };
      if (consulta.startsWith('select v.id_venta from tb_venta v')) return { rows: [{ id_venta: 31 }] };
      if (consulta.includes('from tb_orden_produccion op')) return { rows: [{
        id_orden_produccion: 99, id_venta: 31, tipo: 'Pedido', estado: 'Cancelada',
        historial: [], insumos_requeridos: [], es_venta_local: true,
      }] };
      if (consulta.includes('from tb_detalle_orden_produccion d')) return { rows: [] };
      if (consulta.startsWith('update tb_detalle_orden_produccion') || consulta.startsWith('update tb_orden_produccion')) return { rows: [] };
      if (consulta.startsWith('update tb_venta')) throw new AppError('No se pudo actualizar la venta.', 409);
      throw new Error(`Consulta no esperada en prueba: ${consulta}`);
    },
    release() {},
  } };
  await assert.rejects(
    conBaseSimulada(base, () => completarOrdenProduccion(99, { lineas: null })),
    (error) => error instanceof AppError && error.statusCode === 409,
  );
  assert.equal(consultas.at(-1), 'rollback');
  assert.equal(consultas.includes('commit'), false);
});

test('inicio local usa hora del servidor sin imponer la hora ficticia de recogida', async () => {
  for (const legacy of [false, true]) {
  const orden = {
    id_orden_produccion: 99, id_venta: 31, tipo: 'Pedido', estado: 'Pendiente', es_venta_local: !legacy,
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
  assert.equal(resultado.es_venta_local, true);
  const update = consultas.find(({ consulta }) => consulta.startsWith('update tb_orden_produccion'));
  assert.match(update.consulta, /case when \$6::boolean then current_timestamp at time zone 'america\/bogota'/);
  assert.equal(update.params[5], true);
  assert.equal(consultas.some(({ consulta }) => consulta.includes('as ahora_bogota')), false);
  }
});

test('inicio local con fecha editada rechaza el pasado; la opción automática no aplica a tienda', async () => {
  const orden = {
    id_orden_produccion: 99, id_venta: 31, tipo: 'Pedido', estado: 'Pendiente', es_venta_local: true,
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
  orden.es_venta_local = false;
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
    es_venta_local: true, historial: [], insumos_requeridos: [],
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

test('inicio de pedido sin fecha: local automático; tienda usa recogida futura o ahora + 25 min', async () => {
  const casos = [
    { local: true, esperado: { automatica: true, fecha: undefined } },
    { local: false, recogida: '2026-11-05T18:00:00', esperado: { automatica: false, fecha: '2026-11-05T18:00:00' } },
    { local: false, recogida: '2026-11-05T12:25:00', esperado: { automatica: false, fecha: '2026-11-05T12:25:00' } },
  ];
  for (const caso of casos) {
    const orden = {
      id_orden_produccion: 99, id_venta: 31, tipo: 'Pedido', estado: 'Pendiente', es_venta_local: caso.local,
      fecha_solicitada: '2026-11-05', hora_solicitada: '10:00:00', historial: [], insumos_requeridos: [],
    };
    let update; let calculo;
    const base = { client: {
      async query(sql, params = []) {
        const consulta = sql.replace(/\s+/g, ' ').trim().toLowerCase();
        if (['begin', 'commit', 'rollback'].includes(consulta)) return { rows: [] };
        if (consulta.includes('from tb_orden_produccion op')) return { rows: [{ ...orden }] };
        if (consulta.includes('from tb_detalle_orden_produccion d')) return { rows: [] };
        if (consulta.includes('as fecha_limite')) {
          calculo = { consulta, params };
          return { rows: [{ fecha_limite: caso.recogida }] };
        }
        if (consulta.startsWith('update tb_orden_produccion')) {
          update = params;
          orden.estado = params[1];
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`Consulta no esperada en prueba: ${consulta}`);
      },
      release() {},
    } };
    await conBaseSimulada(base, () => iniciarOrdenProduccion(99, validarGenerarOrdenProduccion({})));
    assert.equal(update[5], caso.esperado.automatica);
    assert.equal(update[2], caso.esperado.fecha);
    if (caso.local) assert.equal(calculo, undefined);
    else {
      assert.match(calculo.consulta, /\$3::int \* interval '1 minute'/);
      assert.deepEqual(calculo.params, ['2026-11-05', '10:00:00', 25]);
    }
  }
});

test('listado y detalle de órdenes exponen es_venta_local desde venta o historial', async () => {
  const queryOriginal = pool.query;
  pool.query = async (sql) => {
    const consulta = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    if (consulta.startsWith('with completadas as') || consulta.startsWith('update tb_venta') || consulta.startsWith("select id_orden_produccion from tb_orden_produccion where tipo = 'preparacion'")) return { rows: [], rowCount: 0 };
    if (consulta.includes('from tb_orden_produccion op')) {
      assert.match(consulta, /coalesce\(v\.venta_local, false\) as es_venta_local/);
      assert.match(consulta, /left join tb_venta v on v\.id_venta = op\.id_venta/);
      return { rows: [
        { id_orden_produccion: 99, id_venta: 31, tipo: 'Pedido', venta_local: 'false', es_venta_local: true, historial: [], insumos_requeridos: [] },
        { id_orden_produccion: 100, id_venta: 32, tipo: 'Pedido', es_venta_local: false, historial: [{ origen: 'venta_panel' }], insumos_requeridos: [] },
        { id_orden_produccion: 101, id_venta: 33, tipo: 'Pedido', venta_local: 'true', es_venta_local: false, historial: [], insumos_requeridos: [] },
        { id_orden_produccion: 102, id_venta: null, tipo: 'Preparacion', es_venta_local: false, historial: [], insumos_requeridos: [] },
      ] };
    }
    if (consulta.includes('from tb_detalle_orden_produccion d')) return { rows: [] };
    throw new Error(`Consulta no esperada en prueba: ${consulta}`);
  };
  try {
    const ordenes = await listarOrdenesProduccion({});
    assert.deepEqual(ordenes.map((orden) => orden.es_venta_local), [true, true, false, false]);
    assert.equal('venta_local' in ordenes[0], false);
    const detalle = await obtenerOrdenProduccion(99);
    assert.equal(detalle.es_venta_local, true);
    assert.equal('venta_local' in detalle, false);
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
  assert.equal(venta.venta_local, false);
  assert.equal(base.estado.estadoPago, 'Pendiente');
  assert.equal(base.estado.producto.stock_partes, 40);
  assert.equal(base.estado.ordenesInsertadas, 0);
});
