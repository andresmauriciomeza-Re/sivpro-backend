import AppError from '../errors/AppError.js';

const CAMPOS = [
  ['mano_obra_hora', 9999999999.99],
  ['tarifa_gas_m3', 9999999999.99],
  ['consumo_gas_m3_hora', 99999.999],
  ['margen_ganancia', 999.99],
];

export function validarActualizarParametrosCostos(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError('Los parámetros de costos deben ser un objeto.', 400);
  }

  const datos = {};
  for (const [campo, maximo] of CAMPOS) {
    const valor = body[campo];
    if (valor === undefined || valor === null || typeof valor === 'boolean' || (typeof valor === 'string' && !valor.trim())) {
      throw new AppError(`El campo ${campo} debe ser un número.`, 400);
    }
    const numero = Number(valor);
    if (!Number.isFinite(numero) || numero < 0 || numero > maximo) {
      throw new AppError(`El campo ${campo} debe ser un número entre 0 y ${maximo}.`, 400);
    }
    datos[campo] = numero;
  }

  return datos;
}
