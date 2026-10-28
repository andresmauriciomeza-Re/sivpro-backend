/**
 * Ejecutor de migraciones SQL (archivos .up.sql / .down.sql).
 * Uso:
 *   node migrations/run-migration.mjs migrations/001_proveedores_campos_juridica.up.sql
 *   node migrations/run-migration.mjs migrations/001_proveedores_campos_juridica.down.sql
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { pool } from '../src/config/db.js';

const archivoArg = process.argv[2];
if (!archivoArg) {
  console.error('Uso: node migrations/run-migration.mjs <ruta-del-archivo.sql>');
  process.exit(1);
}

const rutaAbsoluta = path.resolve(process.cwd(), archivoArg);
if (!fs.existsSync(rutaAbsoluta)) {
  console.error(`No se encontró el archivo de migración: ${rutaAbsoluta}`);
  process.exit(1);
}

const sql = fs.readFileSync(rutaAbsoluta, 'utf8');

try {
  console.log(`Ejecutando migración: ${path.basename(rutaAbsoluta)} ...`);
  await pool.query(sql);
  console.log(`Migración completada con éxito: ${path.basename(rutaAbsoluta)}`);
} catch (error) {
  console.error('Error al ejecutar la migración:', error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
