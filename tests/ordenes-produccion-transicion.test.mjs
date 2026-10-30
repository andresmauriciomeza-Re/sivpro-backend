import assert from 'node:assert/strict';
import test from 'node:test';
import { actualizarOrdenesPorVerificar } from '../src/services/ordenesProduccion.service.js';

test('la transición automática tipa estados y conserva comparación de fechas Bogota', async () => {
  let llamada;
  await actualizarOrdenesPorVerificar({
    async query(text, params) {
      llamada = { text, params };
      return { rowCount: 0 };
    },
  });

  assert.deepEqual(llamada.params, ['Por verificar', 'En proceso']);
  assert.match(llamada.text, /SET estado = \$1::text/);
  assert.match(llamada.text, /'a', \$1::text/);
  assert.match(llamada.text, /WHERE op\.estado = \$2::text/);
  assert.match(llamada.text, /op\.fecha_entrega_estimada IS NULL OR op\.fecha_entrega_estimada <= ahora\.fecha_hora/);
  assert.match(llamada.text, /CURRENT_TIMESTAMP AT TIME ZONE 'America\/Bogota'/);
});
