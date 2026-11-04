import AppError from '../errors/AppError.js';

export function validarInsumosActivos(faltantes, statusCode = 400) {
  const inactivo = faltantes.find((faltante) =>
    typeof faltante.motivo === 'string'
    && /el insumo «.+» está inactivo/i.test(faltante.motivo),
  );
  if (!inactivo) return;

  const error = new AppError(
    `Insumo inactivo: ${inactivo.nombre}. Ve a Insumos para habilitarlo`,
    statusCode,
  );
  error.faltantes = [inactivo];
  throw error;
}
