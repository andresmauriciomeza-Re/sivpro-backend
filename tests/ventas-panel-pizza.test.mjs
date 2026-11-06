import assert from 'node:assert/strict';
import test from 'node:test';
import { pool } from '../src/config/db.js';
import AppError from '../src/errors/AppError.js';
import { anularVenta, crearVentaCliente, crearVentaPanel } from '../src/services/ventas.service.js';
import { validarCrearVenta } from '../src/validators/ventas.validator.js';

function crearBaseVenta({ stockGrande = 10 } = {}) {
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
    },
    venta: null,
    detalles: [],
    estadoPago: null,
    ordenesInsertadas: 0,
  };
  const client = {
    async query(sql, params = []) {
      const consulta = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      if (['begin', 'commit', 'rollback'].includes(consulta)) return { rows: [] };
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
        return { rows: [estado.producto] };
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
        return { rows: [{ id_orden_produccion: 99 }] };
      }
      if (consulta.startsWith('update tb_productos') && consulta.includes('stock_grande = stock_grande - $1')) {
        if (estado.producto.stock_grande < params[0]) return { rows: [] };
        estado.producto.stock_grande -= params[0];
        return { rows: [{ id_producto: params[1] }] };
      }
      if (consulta.startsWith('update tb_productos') && consulta.includes('stock_mediana = stock_mediana - $1')) {
        if (estado.producto.stock_mediana < params[0]) return { rows: [] };
        estado.producto.stock_mediana -= params[0];
        return { rows: [{ id_producto: params[1] }] };
      }
      if (consulta.startsWith('select v.id_venta, v.fecha, v.monto, v.estado')) {
        return {
          rows: estado.venta
            ? [{ ...estado.venta, transcurridos: 60 }]
            : [],
        };
      }
      if (consulta.startsWith('select id_orden_produccion from tb_orden_produccion')) return { rows: [] };
      if (consulta.startsWith('select dv.id_producto, dv.cantidad, dv.tamano, p.tipo')) {
        return {
          rows: estado.detalles.map((detalle) => ({
            ...detalle,
            nombre: estado.producto.nombre,
            tipo: estado.producto.tipo,
            categoria_nombre: estado.producto.categoria_nombre,
          })),
        };
      }
      if (consulta.startsWith('update tb_productos') && consulta.includes('stock_grande = stock_grande + $1')) {
        estado.producto.stock_grande += params[0];
        return { rows: [] };
      }
      if (consulta.startsWith('update tb_productos') && consulta.includes('stock_mediana = stock_mediana + $1')) {
        estado.producto.stock_mediana += params[0];
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

test('venta del panel completa y verifica el pago al descontar porciones sin crear OP', async () => {
  const base = crearBaseVenta();
  const venta = await conBaseSimulada(base, () => crearVentaPanel(clientePanel, {
    horaRecogida: null,
    lineas: [lineaGrande],
    pago: pagoLocal,
  }));

  assert.equal(venta.estado, 'Completado');
  assert.equal(base.estado.estadoPago, 'Verificado');
  assert.equal(base.estado.producto.stock_grande, 7);
  assert.equal(base.estado.ordenesInsertadas, 0);
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
  });
  assert.equal(base.estado.producto.stock_grande, 10);
  assert.equal(base.estado.estadoPago, 'Rechazado');
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
