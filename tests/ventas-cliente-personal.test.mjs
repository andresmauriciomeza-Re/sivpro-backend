import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pool } from '../src/config/db.js';
import { crearVentaCliente } from '../src/services/ventas.service.js';

function crearBaseSimulada({ usuario, perfil = null }) {
  const base = {
    usuario,
    perfil: perfil ? { ...perfil } : null,
    siguienteIdCliente: 100,
    siguienteIdVenta: 200,
    insercionesCliente: 0,
    reactivacionesCliente: 0,
    ventas: [],
    consultas: [],
    locks: new Map(),
  };

  async function bloquearUsuario(id) {
    const anterior = base.locks.get(id) ?? Promise.resolve();
    let liberar;
    const actual = new Promise((resolve) => { liberar = resolve; });
    base.locks.set(id, anterior.then(() => actual));
    await anterior;
    return liberar;
  }

  function personalActivo() {
    const esAdmin = usuario.rol.trim().toLocaleLowerCase('es') === 'administrador';
    const esEmpleado = Boolean(
      usuario.empleado?.estado &&
      usuario.empleado?.contratacionVigente,
    );
    return esAdmin || esEmpleado;
  }

  const conectar = async () => {
    let liberarUsuario = null;
    let liberado = false;
    const liberar = () => {
      if (liberado) return;
      liberado = true;
      liberarUsuario?.();
    };

    return {
      async query(sql, params = []) {
        const consulta = sql.replace(/\s+/g, ' ').trim().toLowerCase();
        base.consultas.push(consulta);

        if (consulta === 'begin' || consulta === 'commit' || consulta === 'rollback') {
          if (consulta !== 'begin') liberar();
          return { rows: [] };
        }

        if (consulta.includes('from tb_usuarios u') && consulta.includes('for update of u')) {
          assert.ok(consulta.includes('u.estado = true'));
          assert.ok(consulta.includes('r.estado = true'));
          assert.ok(consulta.includes("lower(trim(r.nombre)) = 'administrador'"));
          assert.ok(consulta.includes('e.estado = true'));
          assert.ok(consulta.includes('ce.fecha_inicio <= (now() at time zone'));
          assert.ok(consulta.includes('ce.fecha_final is null'));
          const idUsuario = params[0];
          liberarUsuario = await bloquearUsuario(idUsuario);
          if (
            usuario.id !== idUsuario ||
            !usuario.estado ||
            !usuario.rolActivo
          ) {
            return { rows: [] };
          }
          return { rows: [{ id_usuario: idUsuario, es_personal: personalActivo() }] };
        }

        if (consulta.startsWith('select id_cliente, estado from tb_cliente')) {
          return { rows: base.perfil ? [{ ...base.perfil }] : [] };
        }

        if (consulta.startsWith('insert into tb_cliente')) {
          if (!base.perfil) {
            base.perfil = { id_cliente: base.siguienteIdCliente++, estado: true };
            base.insercionesCliente += 1;
          }
          return { rows: [] };
        }

        if (consulta.startsWith('update tb_cliente set estado = true')) {
          if (base.perfil?.estado === false) {
            base.perfil.estado = true;
            base.reactivacionesCliente += 1;
          }
          return { rows: [], rowCount: base.reactivacionesCliente ? 1 : 0 };
        }

        if (consulta.includes('from tb_productos p')) {
          return {
            rows: [{
              id_producto: 1,
              id_categoria: 1,
              nombre: 'Agua',
              tipo: 'Reventa',
              precio_venta: 1000,
              unidad_venta: 'und',
              stock: 20,
              precio_grande: null,
              estado: 'Disponible',
              categoria_nombre: 'Bebidas',
              categoria_activa: true,
            }],
          };
        }

        if (consulta.startsWith('insert into tb_venta')) {
          const venta = {
            id_venta: base.siguienteIdVenta++,
            id_cliente: params[0],
            monto: params[3],
            estado: params[4],
          };
          base.ventas.push(venta);
          return { rows: [venta] };
        }

        if (consulta.startsWith('insert into tb_detalle_venta')) {
          return { rows: [] };
        }

        if (consulta.startsWith('insert into tb_pagos')) {
          return { rows: [{ id_pago: 300 }] };
        }

        throw new Error(`Consulta no simulada en test de ventas: ${consulta}`);
      },
      release: liberar,
    };
  };

  return { base, conectar };
}

function prepararBase(t, opciones) {
  const simulada = crearBaseSimulada(opciones);
  t.mock.method(pool, 'connect', simulada.conectar);
  return simulada.base;
}

function entradaVenta() {
  return {
    lineas: [{ idProducto: 1, cantidad: 1, tamano: null }],
    pago: { tipo: 'Nequi', comprobante: 'https://ejemplo.test/comprobante.png' },
  };
}

function usuario({ id, rol, estado = true, rolActivo = true, empleado = null }) {
  return { id, rol, estado, rolActivo, empleado };
}

test('cliente normal con perfil activo puede comprar', async (t) => {
  const base = prepararBase(t, {
    usuario: usuario({ id: 'cliente-1', rol: 'Cliente' }),
    perfil: { id_cliente: 10, estado: true },
  });

  const venta = await crearVentaCliente('cliente-1', entradaVenta());

  assert.equal(venta.id_cliente, 10);
  assert.equal(base.insercionesCliente, 0);
  assert.equal(base.reactivacionesCliente, 0);
});

test('empleado con ficha y contratación vigentes puede comprar con su perfil activo', async (t) => {
  const base = prepararBase(t, {
    usuario: usuario({
      id: 'empleado-1',
      rol: 'Empleado',
      empleado: { estado: true, contratacionVigente: true },
    }),
    perfil: { id_cliente: 11, estado: true },
  });

  const venta = await crearVentaCliente('empleado-1', entradaVenta());

  assert.equal(venta.id_cliente, 11);
  assert.equal(base.insercionesCliente, 0);
});

test('administrador sin perfil crea uno dentro de la transacción', async (t) => {
  const base = prepararBase(t, {
    usuario: usuario({ id: 'admin-1', rol: 'Administrador' }),
  });

  const venta = await crearVentaCliente('admin-1', entradaVenta());

  assert.equal(base.insercionesCliente, 1);
  assert.equal(base.perfil?.estado, true);
  assert.equal(venta.id_cliente, base.perfil?.id_cliente);
  const inicio = base.consultas.indexOf('begin');
  const insercion = base.consultas.findIndex((consulta) => consulta.startsWith('insert into tb_cliente'));
  const confirmacion = base.consultas.indexOf('commit');
  assert.ok(inicio >= 0 && inicio < insercion && insercion < confirmacion);
});

test('personal activo reactiva un perfil de cliente inactivo', async (t) => {
  const base = prepararBase(t, {
    usuario: usuario({
      id: 'empleado-2',
      rol: 'Empleado',
      empleado: { estado: true, contratacionVigente: true },
    }),
    perfil: { id_cliente: 12, estado: false },
  });

  const venta = await crearVentaCliente('empleado-2', entradaVenta());

  assert.equal(base.reactivacionesCliente, 1);
  assert.equal(base.perfil?.estado, true);
  assert.equal(venta.id_cliente, 12);
  const inicio = base.consultas.indexOf('begin');
  const reactivacion = base.consultas.findIndex((consulta) => consulta.startsWith('update tb_cliente set estado = true'));
  const confirmacion = base.consultas.indexOf('commit');
  assert.ok(inicio >= 0 && inicio < reactivacion && reactivacion < confirmacion);
});

test('usuario no personal sin perfil recibe 403 y no crea filas de venta', async (t) => {
  const base = prepararBase(t, {
    usuario: usuario({ id: 'cliente-2', rol: 'Cliente' }),
  });

  await assert.rejects(
    crearVentaCliente('cliente-2', entradaVenta()),
    (error) => error.statusCode === 403,
  );

  assert.equal(base.insercionesCliente, 0);
  assert.equal(base.ventas.length, 0);
  assert.ok(base.consultas.includes('rollback'));
});

test('cliente normal con perfil inactivo sigue recibiendo 403', async (t) => {
  const base = prepararBase(t, {
    usuario: usuario({ id: 'cliente-3', rol: 'Cliente' }),
    perfil: { id_cliente: 13, estado: false },
  });

  await assert.rejects(
    crearVentaCliente('cliente-3', entradaVenta()),
    (error) => error.statusCode === 403,
  );

  assert.equal(base.reactivacionesCliente, 0);
  assert.equal(base.ventas.length, 0);
});

test('empleado sin contratación vigente no obtiene un perfil por el pedido', async (t) => {
  const base = prepararBase(t, {
    usuario: usuario({
      id: 'empleado-3',
      rol: 'Empleado',
      empleado: { estado: true, contratacionVigente: false },
    }),
  });

  await assert.rejects(
    crearVentaCliente('empleado-3', entradaVenta()),
    (error) => error.statusCode === 403,
  );

  assert.equal(base.insercionesCliente, 0);
  assert.equal(base.ventas.length, 0);
});

test('dos pedidos simultáneos de Admin crean una sola ficha de cliente', async (t) => {
  const base = prepararBase(t, {
    usuario: usuario({ id: 'admin-2', rol: 'Administrador' }),
  });

  const ventas = await Promise.all([
    crearVentaCliente('admin-2', entradaVenta()),
    crearVentaCliente('admin-2', entradaVenta()),
  ]);

  assert.equal(base.insercionesCliente, 1);
  assert.equal(base.ventas.length, 2);
  assert.equal(ventas[0].id_cliente, base.perfil?.id_cliente);
  assert.equal(ventas[1].id_cliente, base.perfil?.id_cliente);
  assert.ok(base.consultas.some((consulta) => consulta.includes('on conflict (id_usuario) do nothing')));
});
