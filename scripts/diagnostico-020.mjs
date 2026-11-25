/**
 * Diagnóstico previo a la migración 020 (solo lectura).
 * Uso: node scripts/diagnostico-020.mjs
 */
import 'dotenv/config';
import { pool } from '../src/config/db.js';

const COLUMNAS = [
  ['tb_compras', 'motivo_anulacion'],
  ['tb_compras', 'fecha_anulacion'],
  ['tb_compras', 'iva_incluido'],
  ['tb_compras', 'subtotal_sin_iva'],
  ['tb_compras', 'total_iva'],
  ['tb_detallecompra', 'base_sin_iva'],
  ['tb_detallecompra', 'monto_iva'],
  ['tb_detallecompra', 'es_no_solicitado'],
];

async function seccion(titulo, fn) {
  console.log(`\n=== ${titulo} ===`);
  try {
    await fn();
  } catch (e) {
    console.log('ERROR:', e.message);
  }
}

try {
  await seccion('a) Columnas', async () => {
    const { rows } = await pool.query(
      `SELECT table_name, column_name, data_type, character_maximum_length, numeric_precision, numeric_scale, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND (table_name, column_name) IN (${COLUMNAS.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(',')})`,
      COLUMNAS.flat(),
    );
    const mapa = new Map(rows.map((r) => [`${r.table_name}.${r.column_name}`, r]));
    for (const [t, c] of COLUMNAS) {
      const r = mapa.get(`${t}.${c}`);
      if (!r) {
        console.log(`${t}.${c}: NO EXISTE`);
        continue;
      }
      const tipo = r.data_type
        + (r.character_maximum_length ? `(${r.character_maximum_length})` : '')
        + (r.data_type === 'numeric' && r.numeric_precision ? `(${r.numeric_precision},${r.numeric_scale})` : '');
      console.log(`${t}.${c}: ${tipo}, ${r.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}, default=${r.column_default ?? '-'}`);
    }
  });

  await seccion('b) Índices/constraints de tb_proveedores que incluyen nit', async () => {
    const idx = await pool.query(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = current_schema() AND tablename = 'tb_proveedores' AND indexdef ~ '\\mnit\\M'`,
    );
    console.log('Índices:', idx.rows.length ? '' : 'ninguno');
    idx.rows.forEach((r) => console.log(` - ${r.indexname}: ${r.indexdef}`));
    const con = await pool.query(
      `SELECT conname, contype, convalidated, pg_get_constraintdef(oid) AS def
         FROM pg_constraint
        WHERE conrelid = 'tb_proveedores'::regclass AND pg_get_constraintdef(oid) ~ '\\mnit\\M'`,
    );
    console.log('Constraints:', con.rows.length ? '' : 'ninguna');
    con.rows.forEach((r) => console.log(` - ${r.conname} (${r.contype}, validado=${r.convalidated}): ${r.def}`));
  });

  await seccion("c) Compras 'Anulado' con motivo NULL o vacío", async () => {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM tb_compras
        WHERE estado = 'Anulado' AND (motivo_anulacion IS NULL OR length(btrim(motivo_anulacion)) = 0)`,
    );
    console.log(rows[0].n);
  });

  await seccion('d) Órdenes de compra sin historial', async () => {
    const t = await pool.query(
      `SELECT table_name, column_name, data_type FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name IN ('tb_ordencompras','tb_ordencompra','tb_estadooc')
        ORDER BY table_name, ordinal_position`,
    );
    t.rows.forEach((r) => console.log(` ${r.table_name}.${r.column_name} (${r.data_type})`));
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM tb_ordencompras o
        WHERE NOT EXISTS (SELECT 1 FROM tb_estadooc e WHERE e.id_ocompra = o.id_ocompra)`,
    );
    console.log('Órdenes sin fila en tb_estadooc:', rows[0].n);
  });

  await seccion('e) NIT duplicados en tb_proveedores', async () => {
    const { rows } = await pool.query(
      `SELECT nit, COUNT(*)::int AS n FROM tb_proveedores WHERE nit IS NOT NULL GROUP BY nit HAVING COUNT(*) > 1`,
    );
    console.log('Valores de NIT duplicados:', rows.length);
    rows.forEach((r) => console.log(` - ${r.nit}: ${r.n} filas`));
  });
} finally {
  await pool.end();
}
