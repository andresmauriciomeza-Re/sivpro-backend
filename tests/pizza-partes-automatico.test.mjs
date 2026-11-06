import assert from 'node:assert/strict';
import test from 'node:test';
import { pool } from '../src/config/db.js';
import { avanzarAutomaticamente } from '../src/services/avanceAutomatico.service.js';
import { validarProductosDeBase } from '../src/services/ventas.service.js';

test('una mediana de 24 partes deja 21: 7 medianas o 5 grandes; ambos tamaños comparten stock', () => {
  const producto = { id_producto: 7, nombre: 'Pizza', tipo: 'Elaborado', categoria_nombre: 'Pizza',
    categoria_activa: true, estado: 'Disponible', precio_venta: 1000, precio_grande: 1200, stock_partes: 24 };
  assert.equal(validarProductosDeBase([{ idProducto: 7, tamano: 'Mediana', cantidad: 1 }], [producto]).length, 1);
  const restante = 24 - 3;
  assert.equal(Math.floor(restante / 3), 7);
  assert.equal(Math.floor(restante / 4), 5);
  assert.throws(() => validarProductosDeBase([
    { idProducto: 7, tamano: 'Mediana', cantidad: 4 },
    { idProducto: 7, tamano: 'Grande', cantidad: 4 },
  ], [producto]), (error) => error.statusCode === 409
    && error.message === 'Solo alcanzan 8 porciones medianas o 6 grandes de Pizza');
  assert.throws(() => validarProductosDeBase(
    [{ idProducto: 7, tamano: 'Mediana', cantidad: 1 }],
    [{ ...producto, estado: 'No disponible', stock_partes: 2 }],
  ), (error) => error.statusCode === 409
    && error.message === 'Solo alcanzan 0 porciones medianas o 0 grandes de Pizza');
});

test('avance completa solo preparación vencida, asigna precio y suma inventario una vez', async () => {
  const orden = { id_orden_produccion: 1, tipo: 'Preparacion', estado: 'En proceso',
    preparacion_vencida: true, stock_aplicado: false, historial: [] };
  const lineas = [
    { id_detalle_op: 11, id_producto: 7, id_insumo: null, nombre: 'Pizza', tamano: null,
      cantidad_estimada: 1, cantidad_debida: 1, insumos_consumidos: { insumos: [] }, unidad: 'und' },
    { id_detalle_op: 12, id_producto: null, id_insumo: 8, nombre: 'Masa', tamano: null,
      cantidad_estimada: 2, cantidad_debida: 2, insumos_consumidos: { insumos: [] }, unidad: 'und' },
  ];
  const estado = { partes: 0, insumo: 0, mediana: 0, grande: 3000, historial: [] };
  const queryOriginal = pool.query;
  const connectOriginal = pool.connect;
  pool.query = async (sql) => {
    const q = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    if (q.startsWith('with completadas as')) return { rows: [] };
    if (q.startsWith('update tb_venta')) return { rows: [], rowCount: 0 };
    if (q.startsWith('select id_orden_produccion from tb_orden_produccion')) {
      assert.match(q, /tiempo_preparacion_min > 0/);
      assert.match(q, /fecha_en_proceso \+ tiempo_preparacion_min \* interval '1 minute' <=/);
      return { rows: orden.estado === 'En proceso' ? [{ id_orden_produccion: 1 }] : [] };
    }
    throw new Error(`Consulta inesperada: ${q}`);
  };
  pool.connect = async () => ({
    async query(sql, params = []) {
      const q = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      if (['begin', 'commit', 'rollback'].includes(q)) return { rows: [] };
      if (q.includes('from tb_orden_produccion op')) return { rows: [{ ...orden }] };
      if (q.includes('from tb_detalle_orden_produccion d')) return { rows: lineas };
      if (q.startsWith('select c.nombre from tb_productos')) return { rows: [{ nombre: 'Pizza' }] };
      if (q.startsWith('select precio_venta, precio_grande')) return { rows: [{ precio_venta: estado.mediana, precio_grande: estado.grande }] };
      if (q.startsWith('select id_ft, cantidad, tiempo_preparacion')) return { rows: [{ id_ft: 4, cantidad: 1, tiempo_preparacion: 0 }] };
      if (q.includes('from tb_insumo_ficha_tecnica f')) return { rows: [{ cantidad: 1, medida: 'kg', nombre: 'Harina', unidad_medida: 'kg', costo_unitario: 24000 }] };
      if (q.includes('from tb_parametros_costos')) return { rows: [{ mano_obra_hora: 0, tarifa_gas_m3: 0, consumo_gas_m3_hora: 0, margen_ganancia: 40 }] };
      if (q.startsWith('update tb_productos set precio_venta')) {
        estado.mediana = params[1]; estado.grande = params[2]; return { rowCount: 1, rows: [] };
      }
      if (q.startsWith('update tb_productos set stock_partes')) {
        estado.partes += params[1]; return { rowCount: 1, rows: [] };
      }
      if (q.startsWith('update tb_insumo')) {
        estado.insumo += params[1]; return { rowCount: 1, rows: [] };
      }
      if (q.startsWith('update tb_detalle_orden_produccion')) return { rowCount: 1, rows: [] };
      if (q.startsWith('update tb_orden_produccion')) {
        orden.estado = params[1]; estado.historial = JSON.parse(params[2]); return { rowCount: 1, rows: [] };
      }
      throw new Error(`Consulta inesperada: ${q}`);
    },
    release() {},
  });
  try {
    await avanzarAutomaticamente();
    await avanzarAutomaticamente();
    assert.equal(orden.estado, 'Completada');
    assert.equal(estado.partes, 24);
    assert.equal(estado.insumo, 2);
    assert.equal(estado.mediana, 2700);
    assert.equal(estado.grande, 3000);
    assert.equal(estado.historial[0].automatico, true);
    assert.match(estado.historial[0].detalle, /Precio Mediana asignado automáticamente.*por debajo del costo/);
  } finally {
    pool.query = queryOriginal;
    pool.connect = connectOriginal;
  }
});

test('la preparación aún no vencida no se completa tras bloquearla', async () => {
  const original = pool.connect;
  let actualizaciones = 0;
  pool.connect = async () => ({
    async query(sql) {
      const q = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      if (['begin', 'commit', 'rollback'].includes(q)) return { rows: [] };
      if (q.includes('from tb_orden_produccion op')) {
        assert.match(q, /op\.tiempo_preparacion_min > 0 then extract\(epoch/);
        assert.match(q, /op\.tiempo_preparacion_min > 0 and op\.fecha_en_proceso/);
        return { rows: [{ tipo: 'Preparacion', estado: 'En proceso', preparacion_vencida: false }] };
      }
      if (q.includes('from tb_detalle_orden_produccion d')) return { rows: [] };
      if (q.startsWith('update')) actualizaciones++;
      throw new Error(`Consulta inesperada: ${q}`);
    },
    release() {},
  });
  try {
    const { completarPreparacionAutomatica } = await import('../src/services/ordenesProduccion.service.js');
    assert.equal(await completarPreparacionAutomatica(1), null);
    assert.equal(actualizaciones, 0);
  } finally {
    pool.connect = original;
  }
});
