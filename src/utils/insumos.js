import AppError from '../errors/AppError.js';

export const UNIDADES_INSUMO = ['kg', 'g', 'lt', 'ml', 'und', 'paq', 'caja', 'bolsa'];

export function normalizarNombreInsumo(valor) {
  const limpio = typeof valor === 'string' ? valor.trim().replace(/\s+/g, ' ') : '';
  return limpio ? limpio.charAt(0).toLocaleUpperCase('es') + limpio.slice(1) : '';
}

export function compararNombreInsumo(valor) {
  return String(valor ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');
}

export function convertirUnidad(cantidad, medida, unidad, nombreInsumo) {
  if (medida === unidad) return Number(cantidad);

  let factor;
  if (medida === 'kg' && unidad === 'g') factor = 1000;
  else if (medida === 'g' && unidad === 'kg') factor = 0.001;
  else if (medida === 'lt' && unidad === 'ml') factor = 1000;
  else if (medida === 'ml' && unidad === 'lt') factor = 0.001;

  if (factor === undefined) {
    throw new AppError(`La medida «${medida}» no es compatible con la unidad de «${nombreInsumo}» (${unidad})`, 400);
  }
  return Number(cantidad) * factor;
}

export function normalizarPasos(valor) {
  if (valor == null) return null;
  if (Array.isArray(valor)) return valor;
  try {
    const pasos = JSON.parse(valor);
    return Array.isArray(pasos) ? pasos : [String(valor)];
  } catch {
    return [String(valor)];
  }
}

export function redondearDosDecimales(valor) {
  return Math.round((Number(valor) + Number.EPSILON) * 100) / 100;
}
