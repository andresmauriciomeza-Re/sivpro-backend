import assert from 'node:assert/strict';
import test from 'node:test';
import { pool } from '../src/config/db.js';
import { iniciarOrdenProduccion } from '../src/services/ordenesProduccion.service.js';
import { validarGenerarOrdenProduccion } from '../src/validators/ordenesProduccion.validator.js';

for (const minutos of [35, 0]) {
  test(`generar preparación sin fecha con ${minutos} minutos`, async () => {
    const inicio = Date.parse('2026-11-06T12:00:00Z');
    const orden = {
      id_orden_produccion: 1, tipo: 'Preparacion', estado: 'Pendiente',
      tiempo_preparacion_min: minutos, historial: [], insumos_requeridos: [],
    };
    const linea = {
      id_detalle_op: 11, id_producto: 7, id_insumo: null, id_ft: 4,
      nombre: 'Pizza', cantidad_estimada: 1, unidad: 'und',
    };
    const anterior = pool.connect;
    let update;
    pool.connect = async () => ({
      async query(sql, params = []) {
        const q = sql.replace(/\s+/g, ' ').trim().toLowerCase();
        if (['begin', 'commit', 'rollback'].includes(q)) return { rows: [] };
        if (q.includes('from tb_orden_produccion op')) return { rows: [{ ...orden }] };
        if (q.includes('from tb_detalle_orden_produccion d')) return { rows: [{ ...linea }] };
        if (q.startsWith('select p.id_producto')) return { rows: [{
          id_producto: 7, nombre: 'Pizza', tipo: 'Elaborado', categoria_nombre: 'Pizza',
          id_ft: 4, cantidad: 1, medida: 'und', tiempo_preparacion: minutos, pasos: [],
        }] };
        if (q.includes('from tb_insumo_ficha_tecnica')) return { rows: [] };
        if (q.startsWith('update tb_detalle_orden_produccion')) return { rows: [], rowCount: 1 };
        if (q.startsWith('update tb_orden_produccion')) {
          update = { q, params };
          orden.estado = params[1];
          orden.fecha_en_proceso = new Date(inicio).toISOString();
          orden.fecha_entrega_estimada_local = minutos > 0
            ? new Date(inicio + minutos * 60_000).toISOString()
            : null;
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`Consulta inesperada: ${q}`);
      },
      release() {},
    });
    try {
      const datos = validarGenerarOrdenProduccion({ lineas: [{ id_detalle_op: 11, cantidad: 1 }] });
      assert.equal('fecha_entrega_estimada' in datos, false);
      const resultado = await iniciarOrdenProduccion(1, datos);
      assert.equal(resultado.estado, 'En proceso');
      assert.match(update.q, /fecha_en_proceso = current_timestamp at time zone 'america\/bogota'/);
      assert.match(update.q, /case when tiempo_preparacion_min > 0 then \(current_timestamp at time zone 'america\/bogota'\) \+ tiempo_preparacion_min \* interval '1 minute' else null end/);
      if (minutos > 0) {
        assert.equal(Date.parse(resultado.fecha_entrega_estimada) - Date.parse(resultado.fecha_en_proceso), minutos * 60_000);
      } else {
        assert.equal(resultado.fecha_entrega_estimada, null);
      }
    } finally {
      pool.connect = anterior;
    }
  });
}
