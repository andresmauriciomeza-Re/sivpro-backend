import assert from 'node:assert/strict';
import test from 'node:test';
import { pool } from '../src/config/db.js';
import { obtenerCatalogoPublico, obtenerProductosGestion } from '../src/controllers/productos.controller.js';

test('catálogo y gestión exponen ambas disponibilidades desde las mismas partes', async () => {
  const anterior = pool.query;
  pool.query = async (sql) => {
    assert.match(sql, /p\.stock_partes/);
    assert.match(sql, /FLOOR\(p\.stock_partes::numeric \/ 3\)::int AS disponibles_mediana/);
    assert.match(sql, /FLOOR\(p\.stock_partes::numeric \/ 4\)::int AS disponibles_grande/);
    return { rows: [{ stock_partes: 21, disponibles_mediana: 7, disponibles_grande: 5 }] };
  };
  try {
    for (const controlador of [obtenerCatalogoPublico, obtenerProductosGestion]) {
      let resultado;
      await controlador({}, { json: (filas) => { resultado = filas; } }, (error) => { throw error; });
      assert.deepEqual(resultado, [{ stock_partes: 21, disponibles_mediana: 7, disponibles_grande: 5 }]);
    }
  } finally {
    pool.query = anterior;
  }
});
