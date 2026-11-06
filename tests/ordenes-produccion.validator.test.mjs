import assert from 'node:assert/strict';
import test from 'node:test';
import AppError from '../src/errors/AppError.js';
import { crearPreparacionEnTransaccion } from '../src/services/ordenesProduccion.service.js';
import {
  validarCompletarOrdenProduccion,
  validarCrearOrdenProduccion,
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
