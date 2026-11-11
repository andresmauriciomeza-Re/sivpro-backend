import AppError from '../errors/AppError.js';

/**
 * Unidad base de un insumo: solo medidas directas (regla 2.2, Caso A).
 * Las presentaciones (paq, paca, caja, bolsa, sixpack) NO son unidades base:
 * son presentaciones de compra que se convierten con un factor.
 */
export const UNIDADES_BASE_INSUMO = ['kg', 'g', 'lt', 'ml', 'und'];

/**
 * Presentaciones que históricamente se aceptaron como `unidad_medida` de un
 * insumo (paq, caja, bolsa). NO se eliminan para no romper insumos ya
 * existentes: si un insumo tiene una de estas como unidad base, se trata como
 * unidad base con factor de presentación 1 (ver `convertirABase` en
 * utils/compras.js). `paca` y `sixpack` nunca fueron unidades base.
 */
export const UNIDADES_BASE_LEGADAS = ['paq', 'caja', 'bolsa'];

/**
 * Catálogo completo que acepta `unidad_medida` al crear/editar un insumo
 * (incluye las unidades legadas para no romper registros existentes).
 */
export const UNIDADES_INSUMO = [...UNIDADES_BASE_INSUMO, ...UNIDADES_BASE_LEGADAS];

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
