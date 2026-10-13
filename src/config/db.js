import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  connectionTimeoutMillis: 15000,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('Error en conexión inactiva de la base de datos:', err.code);
});

export function query(text, params) {
  return pool.query(text, params);
}
