import assert from 'node:assert/strict';
import test from 'node:test';
import nodemailer from 'nodemailer';
import { pool } from '../src/config/db.js';
import { avanzarAutomaticamente } from '../src/services/avanceAutomatico.service.js';
import { buildEstadoPedidoEmail } from '../src/utils/emailTemplates.js';

test('avance automático respeta los 25 minutos y la recogida de tienda sin mover stock', async () => {
  const ordenes = [
    { id_orden_produccion: 1, id_venta: 1, tipo: 'Pedido', estado: 'En proceso', minutos: 25, estimada: 3, real: null },
    { id_orden_produccion: 2, id_venta: 2, tipo: 'Pedido', estado: 'En proceso', minutos: 24.99, estimada: 2, real: null },
    { id_orden_produccion: 3, id_venta: 3, tipo: 'Pedido', estado: 'En proceso', minutos: 26, estimada: 1, real: null },
    { id_orden_produccion: 4, id_venta: 4, tipo: 'Pedido', estado: 'En proceso', minutos: 26, estimada: 1, real: null },
    { id_orden_produccion: 5, id_venta: 5, tipo: 'Pedido', estado: 'Cancelada', minutos: 30, estimada: 1, real: null },
    { id_orden_produccion: 8, id_venta: 8, tipo: 'Pedido', estado: 'En proceso', minutos: 25, estimada: 1, real: null },
    { id_orden_produccion: 9, id_venta: 8, tipo: 'Pedido', estado: 'En proceso', minutos: 20, estimada: 1, real: null },
    { id_orden_produccion: 6, id_venta: 6, tipo: 'Preparacion', estado: 'En proceso', minutos: 30, estimada: 1, real: null },
  ];
  const ventas = [
    { id_venta: 1, local: true, minutos: 25, estado: 'Por entregar' },
    { id_venta: 2, local: true, minutos: 24.99, estado: 'Por entregar' },
    { id_venta: 3, local: false, recogidaPasada: false, estado: 'Por entregar' },
    { id_venta: 4, local: false, recogidaPasada: true, estado: 'Por entregar' },
    { id_venta: 5, local: true, minutos: 10, estado: 'Por entregar' },
    { id_venta: 7, local: true, minutos: 25, estado: 'Por entregar' },
    { id_venta: 8, local: false, recogidaPasada: false, estado: 'Por entregar' },
  ];
  const { query: consultaOriginal, connect: conectarOriginal } = pool;
  const transporteOriginal = nodemailer.createTransport;
  const { MAIL_USER, MAIL_PASS } = process.env;
  process.env.MAIL_USER = 'prueba@example.test';
  process.env.MAIL_PASS = 'prueba';
  const correos = [];
  nodemailer.createTransport = () => ({ sendMail: async (correo) => { correos.push(correo); } });
  const pedidos = (id) => ordenes.filter((o) => o.id_venta === id && o.tipo === 'Pedido');
  const consulta = async (sql, params) => {
    const texto = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    if (['begin', 'rollback', 'commit'].includes(texto)) return { rows: [] };
    if (texto.endsWith('for no key update')) {
      return { rows: ventas.map(({ id_venta }) => ({ id_venta })) };
    }
    if (texto.startsWith('with completadas as')) {
      assert.equal(params[0], 'America/Bogota');
      assert.match(texto, /tipo = 'pedido' and estado = 'en proceso'/);
      assert.match(texto, /fecha_en_proceso \+ interval '25 minutes' <= now\(\) at time zone \$1::text/);
      assert.match(texto, /set cantidad_real = d\.cantidad_estimada/);
      assert.match(texto, /'automatico', true/);
      assert.doesNotMatch(texto, /tb_productos\b|tb_insumo\b/);
      const actualizadas = ordenes.filter((o) => o.tipo === 'Pedido' && o.estado === 'En proceso' && o.minutos >= 25);
      for (const o of actualizadas) { o.estado = 'Completada'; o.real = o.estimada; }
      return { rows: actualizadas.map(({ id_orden_produccion, id_venta }) => ({ id_orden_produccion, id_venta })) };
    }
    if (texto.startsWith('update tb_venta')) {
      assert.match(texto, /venta_local = true and \(\s*fecha_estado \+ interval '25 minutes'/);
      assert.match(texto, /venta_local = false and hora_recogida is not null/);
      assert.match(texto, /op\.estado is distinct from 'completada'/);
      const actualizadas = ventas.filter((v) => {
        const ops = pedidos(v.id_venta);
        const todasCompletadas = ops.every((o) => o.estado === 'Completada');
        return v.estado === 'Por entregar' && (v.local
          ? v.minutos >= 25 || (ops.length > 0 && todasCompletadas)
          : v.recogidaPasada && todasCompletadas);
      });
      for (const v of actualizadas) v.estado = 'Completado';
      return { rows: actualizadas.map(({ id_venta }) => ({ id_venta })), rowCount: actualizadas.length };
    }
    if (texto.startsWith('select id_orden_produccion from tb_orden_produccion')) return { rows: [] };
    if (texto.startsWith('select id_venta from tb_venta')) {
      assert.match(texto, /op\.estado is distinct from 'completada'/);
      return { rows: ventas.filter((v) => params[0].includes(v.id_venta) && !v.local
        && v.estado === 'Por entregar' && pedidos(v.id_venta).every((o) => o.estado === 'Completada')) };
    }
    if (texto.includes('u.correo, op.estado as estado_orden')) {
      return { rows: [{ id_venta: params[0], correo: params[0] === 7 ? null : `pedido${params[0]}@example.test`, monto: 25000, hora_recogida: '18:05:00' }] };
    }
    if (texto.includes('from tb_detalle_venta dv')) return { rows: [{ nombre: 'Pizza', cantidad: 2 }] };
    throw new Error(`Consulta inesperada: ${texto}`);
  };
  pool.query = consulta;
  pool.connect = async () => ({ query: consulta, release() {} });
  try {
    assert.equal(await avanzarAutomaticamente(), 3);
    assert.deepEqual(ordenes.map((o) => [o.estado, o.real]), [
      ['Completada', 3], ['En proceso', null], ['Completada', 1],
      ['Completada', 1], ['Cancelada', null], ['Completada', 1],
      ['En proceso', null], ['En proceso', null],
    ]);
    assert.deepEqual(ventas.map((v) => v.estado), [
      'Completado', 'Por entregar', 'Por entregar', 'Completado', 'Por entregar', 'Completado', 'Por entregar',
    ]);
    assert.equal(await avanzarAutomaticamente(), 0);
    await new Promise(setImmediate);
    assert.deepEqual(Object.fromEntries(correos.map(({ to, subject }) => [to, subject])), {
      'pedido1@example.test': '¡Muchas gracias por tu compra!',
      'pedido3@example.test': 'Tu pedido está listo para recoger',
      'pedido4@example.test': '¡Muchas gracias por tu compra!',
    });
    assert.equal(correos.length, 3);
    assert.match(correos.find(({ to }) => to === 'pedido4@example.test').text, /factura=4/);
    assert.match(correos.find(({ to }) => to === 'pedido3@example.test').text, /6:05 p\. m\./);
    assert.match(correos.find(({ to }) => to === 'pedido3@example.test').text, /Dirección de recogida:/);

    ordenes.find((o) => o.id_orden_produccion === 9).minutos = 25;
    assert.equal(await avanzarAutomaticamente(), 0);
    await new Promise(setImmediate);
    assert.equal(correos.length, 4);
    assert.equal(correos[3].to, 'pedido8@example.test');
    assert.equal(correos[3].subject, 'Tu pedido está listo para recoger');
  } finally {
    pool.query = consultaOriginal;
    pool.connect = conectarOriginal;
    nodemailer.createTransport = transporteOriginal;
    if (MAIL_USER === undefined) delete process.env.MAIL_USER;
    else process.env.MAIL_USER = MAIL_USER;
    if (MAIL_PASS === undefined) delete process.env.MAIL_PASS;
    else process.env.MAIL_PASS = MAIL_PASS;
  }
});

test('el correo de preparación usa la etiqueta del cliente en todo el mensaje', () => {
  const { subject, text, html } = buildEstadoPedidoEmail({ id: 31, estado: 'En proceso' });
  assert.equal(subject, 'Tu pedido ya está en preparación');
  assert.match(text, /Estado actual: En preparación/);
  assert.doesNotMatch(text + html, /En proceso/);
});
