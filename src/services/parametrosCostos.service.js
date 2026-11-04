import AppError from '../errors/AppError.js';
import { query } from '../config/db.js';

const COLUMNAS = `
  id_parametro, mano_obra_hora, tarifa_gas_m3, consumo_gas_m3_hora,
  margen_ganancia, fecha_actualizacion`;

function mapearParametros(row) {
  if (!row) throw new AppError('No se encontraron los parámetros de costos.', 503);
  return {
    id_parametro: Number(row.id_parametro),
    mano_obra_hora: Number(row.mano_obra_hora),
    tarifa_gas_m3: Number(row.tarifa_gas_m3),
    consumo_gas_m3_hora: Number(row.consumo_gas_m3_hora),
    margen_ganancia: Number(row.margen_ganancia),
    fecha_actualizacion: row.fecha_actualizacion,
  };
}

export async function obtenerParametrosCostos() {
  const { rows } = await query(
    `SELECT ${COLUMNAS} FROM tb_parametros_costos WHERE id_parametro = 1`,
  );
  return mapearParametros(rows[0]);
}

export async function actualizarParametrosCostos(datos) {
  const { rows } = await query(
    `UPDATE tb_parametros_costos
        SET mano_obra_hora = $1,
            tarifa_gas_m3 = $2,
            consumo_gas_m3_hora = $3,
            margen_ganancia = $4,
            fecha_actualizacion = now()
      WHERE id_parametro = 1
      RETURNING ${COLUMNAS}`,
    [
      datos.mano_obra_hora,
      datos.tarifa_gas_m3,
      datos.consumo_gas_m3_hora,
      datos.margen_ganancia,
    ],
  );
  return mapearParametros(rows[0]);
}
