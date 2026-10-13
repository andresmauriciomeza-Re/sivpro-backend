import AppError from '../errors/AppError.js';
import { query } from '../config/db.js';

export async function verificarBaseDatos() {
  try {
    const { rows } = await query('SELECT nombre FROM tb_roles ORDER BY id_rol');
    return { conectado: true, roles: rows.map((row) => row.nombre) };
  } catch (error) {
    console.error('Error de base de datos:', error.code);
    throw new AppError('No se pudo conectar con la base de datos.', 503);
  }
}
