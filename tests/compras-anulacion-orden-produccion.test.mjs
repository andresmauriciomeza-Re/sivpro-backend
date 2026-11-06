import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buscarOrdenProduccionConInsumo,
  mensajeInsumoEnOrdenProduccion,
} from '../src/services/compras.service.js';

/** `client` simulado: registra cada consulta y devuelve las filas fijadas. */
function clienteFalso(rows) {
  const llamadas = [];
  return {
    llamadas,
    async query(sql, params) {
      llamadas.push({ sql, params });
      return { rows, rowCount: rows.length };
    },
  };
}

test('buscarOrdenProduccionConInsumo mira órdenes activas, excluye Cancelada y trae la más reciente', async () => {
  const client = clienteFalso([{ id_orden_produccion: 42, estado: 'En proceso' }]);

  const orden = await buscarOrdenProduccionConInsumo(client, 7);

  assert.deepEqual(orden, { id_orden_produccion: 42, estado: 'En proceso' });
  const { sql, params } = client.llamadas[0];
  assert.deepEqual(params, [7]);

  // Sólo las órdenes en uso: 'Pendiente', 'En proceso' y 'Completada'.
  assert.match(sql, /o\.estado IN \('Pendiente', 'En proceso', 'Completada'\)/);
  // La Cancelada nunca bloquea la anulación.
  assert.doesNotMatch(sql, /'Cancelada'/);
  // Devuelve UNA sola orden (la de id más alto).
  assert.match(sql, /ORDER BY o\.id_orden_produccion DESC\s+LIMIT 1/);

  // Camino 1: la ficha técnica de la línea apunta al insumo.
  assert.match(sql, /FROM tb_insumo_ficha_tecnica ift/);
  assert.match(sql, /ift\.id_ft = d\.id_ft/);
  assert.match(sql, /ift\.id_insumo = \$1/);

  // Camino 2: el snapshot de consumo de la línea (líneas sin ficha y recetas
  // modificadas después de crear la orden).
  assert.match(sql, /insumos_consumidos/);
  assert.match(sql, /jsonb_build_object\('id_insumo', \$1::int\)/);
});

test('buscarOrdenProduccionConInsumo devuelve null cuando ninguna orden usa el insumo', async () => {
  const client = clienteFalso([]);

  assert.equal(await buscarOrdenProduccionConInsumo(client, 99), null);
  assert.equal(client.llamadas.length, 1);
  assert.deepEqual(client.llamadas[0].params, [99]);
});

test('mensajeInsumoEnOrdenProduccion nombra el insumo, el id de la orden y su estado', () => {
  assert.equal(
    mensajeInsumoEnOrdenProduccion('Harina', { id_orden_produccion: 42, estado: 'Pendiente' }),
    'No se puede anular: el insumo «Harina» está siendo utilizado en la orden de producción N° 42 (Pendiente).'
  );
  assert.equal(
    mensajeInsumoEnOrdenProduccion('Queso', { id_orden_produccion: 7, estado: 'Completada' }),
    'No se puede anular: el insumo «Queso» está siendo utilizado en la orden de producción N° 7 (Completada).'
  );
});
