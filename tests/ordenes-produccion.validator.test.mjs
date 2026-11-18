import assert from 'node:assert/strict';
import test from 'node:test';
import AppError from '../src/errors/AppError.js';
import { pool } from '../src/config/db.js';
import { actualizarOrdenProduccion, crearPreparacionEnTransaccion } from '../src/services/ordenesProduccion.service.js';
import {
  validarCompletarOrdenProduccion,
  validarCrearOrdenProduccion,
  validarEditarOrdenProduccion,
} from '../src/validators/ordenesProduccion.validator.js';

const ordenPreparacionValida = { lineas: [{ id_producto: 7, cantidad: 3 }] };

test('una OP de preparación sigue naciendo Pendiente', async () => {
  let insercion;
  let detalle;
  const client = {
    async query(sql, params = []) {
      const consulta = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      if (consulta.startsWith('select p.id_producto, p.nombre, p.tipo, p.unidad_venta')) {
        return { rows: [{ id_producto: 7, nombre: 'Pizza prueba', tipo: 'Elaborado', unidad_venta: 'und', categoria_nombre: 'Pizza' }] };
      }
      if (consulta.startsWith('select id_ft, id_producto')) return { rows: [{ id_ft: 11, id_producto: 7 }] };
      if (consulta.startsWith('select p.id_producto, p.nombre, p.tipo, c.nombre')) {
        return { rows: [{ id_producto: 7, nombre: 'Pizza prueba', tipo: 'Elaborado', categoria_nombre: 'Pizza', id_ft: 11, cantidad: 1, medida: 'und', porciones: 8, tiempo_preparacion: 14, pasos: [] }] };
      }
      if (consulta.includes('from tb_insumo_ficha_tecnica')) return { rows: [] };
      if (consulta.startsWith('insert into tb_orden_produccion')) {
        insercion = { consulta, params };
        return { rows: [{ id_orden_produccion: 10 }] };
      }
      if (consulta.startsWith('insert into tb_detalle_orden_produccion')) { detalle = params; return { rows: [] }; }
      throw new Error(`Consulta no esperada en prueba: ${consulta}`);
    },
  };
  await crearPreparacionEnTransaccion(client, {
    lineas: [{ id_producto: 7, cantidad: 1 }],
  });
  assert.equal(insercion.params[0], 'Preparacion');
  assert.equal(insercion.params[3], 'Pendiente');
  assert.equal(JSON.parse(insercion.params[5])[0].a, 'Pendiente');
  assert.doesNotMatch(insercion.consulta, /fecha_en_proceso/);
  assert.equal(detalle[7], null);
});

test('la creación de una orden valida stock por defecto y permite desactivarlo explícitamente', () => {
  assert.equal(validarCrearOrdenProduccion(ordenPreparacionValida).validar_stock, true);
  assert.equal(
    validarCrearOrdenProduccion({ ...ordenPreparacionValida, validar_stock: false }).validar_stock,
    false,
  );
});

test('validar_stock debe ser booleano al crear una orden', () => {
  assert.throws(
    () => validarCrearOrdenProduccion({ ...ordenPreparacionValida, validar_stock: 'false' }),
    (error) => error instanceof AppError && error.statusCode === 400,
  );
});

test('la verificación solo acepta cantidades reales y descarta cantidad debida enviada por el cliente', () => {
  const resultado = validarCompletarOrdenProduccion({
    lineas: [{ id_detalle_op: 7, cantidad_real: 12, cantidad_debida: 999 }],
  });

  assert.deepEqual(resultado, {
    lineas: [{ id_detalle_op: 7, cantidad_real: 12 }],
  });
});

test('el validador conserva tamaños distintos para editar líneas antiguas, pero no repite el mismo tamaño', () => {
  const datos = validarCrearOrdenProduccion({
    lineas: [
      { id_producto: 7, cantidad: 2, tamano: 'Mediana' },
      { id_producto: 7, cantidad: 1, tamano: 'Grande' },
    ],
  });
  assert.deepEqual(datos.lineas.map((l) => [l.tamano, l.cantidad]), [['Mediana', 2], ['Grande', 1]]);
  assert.throws(
    () => validarCrearOrdenProduccion({
      lineas: [
        { id_producto: 7, cantidad: 2, tamano: 'Grande' },
        { id_producto: 7, cantidad: 1, tamano: 'Grande' },
      ],
    }),
    (error) => error instanceof AppError && error.statusCode === 400,
  );
});

test('la cantidad real de verificación debe ser un entero no negativo', () => {
  for (const cantidad_real of [-1, 1.5]) {
    assert.throws(
      () => validarCompletarOrdenProduccion({
        lineas: [{ id_detalle_op: 7, cantidad_real }],
      }),
      (error) => error instanceof AppError && error.statusCode === 400,
    );
  }
});


test('el tiempo editable acepta los límites y rechaza valores inválidos', () => {
  for (const minutos of [5, 25, 180]) {
    assert.equal(validarEditarOrdenProduccion({ tiempo_preparacion_min: minutos }).tiempo_preparacion_min, minutos);
  }
  for (const minutos of [4, 181, 5.5, null, '25']) {
    assert.throws(() => validarEditarOrdenProduccion({ tiempo_preparacion_min: minutos }), { statusCode: 400 });
  }
});

test('solo el administrador ajusta pedidos activos y serializa el cambio con el cierre', async (t) => {
  const row = { id_orden_produccion: 17, tipo: 'Pedido', estado: 'Pendiente', tiempo_preparacion_min: null };
  const operaciones = [];
  const conectar = pool.connect;
  t.after(() => { pool.connect = conectar; });
  pool.connect = async () => ({
    async query(sql, params) {
      const consulta = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      if (['begin', 'commit', 'rollback'].includes(consulta)) return { rows: [] };
      if (consulta.endsWith('for no key update of v')) {
        operaciones.push('bloquear venta');
        return { rows: [{ estado: 'Por entregar' }] };
      }
      if (consulta.includes('from tb_orden_produccion op')) {
        if (consulta.endsWith('for update of op')) operaciones.push('bloquear orden');
        return { rows: [{ ...row }] };
      }
      if (consulta.includes('from tb_detalle_orden_produccion')) return { rows: [] };
      assert.match(consulta, /^update tb_orden_produccion set tiempo_preparacion_min/);
      assert.match(consulta, /estado = 'en proceso' and fecha_en_proceso \+ \$2::int \* interval '1 minute' <= clock_timestamp\(\)/);
      assert.match(consulta, /'cierre_manual_por_tiempo'/);
      assert.doesNotMatch(consulta, /venta_local|set estado/);
      operaciones.push('guardar minutos');
      row.tiempo_preparacion_min = params[1];
      return { rows: [] };
    },
    release() {},
  });

  const ajustar = (tiempo_preparacion_min, esAdministrador) =>
    actualizarOrdenProduccion(17, { tiempo_preparacion_min }, { esAdministrador });
  await assert.rejects(ajustar(10, false), { statusCode: 403 });
  assert.deepEqual(operaciones, []);
  assert.equal((await ajustar(40, true)).tiempo_preparacion_min, 40);
  assert.deepEqual(operaciones.splice(0), ['bloquear venta', 'bloquear orden', 'guardar minutos']);
  row.estado = 'En proceso';
  assert.equal((await ajustar(5, true)).estado, 'En proceso');
  assert.deepEqual(operaciones.splice(0), ['bloquear venta', 'bloquear orden', 'guardar minutos']);
  for (const estado of ['Completada', 'Cancelada']) {
    row.estado = estado;
    await assert.rejects(ajustar(10, true), { statusCode: 409 });
  }
  assert.equal(row.tiempo_preparacion_min, 5);
});
