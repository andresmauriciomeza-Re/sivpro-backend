import AppError from '../errors/AppError.js';
import { convertirUnidad, redondearDosDecimales } from './insumos.js';

/**
 * Catálogo único de presentaciones/medidas aceptadas en Compras y Orden de
 * Compra. Debe coincidir con el frontend (`shared/utils/unidades.ts`) y con
 * los CHECK de la base de datos.
 */
export const UNIDADES_COMPRA = new Set(['kg', 'g', 'lt', 'ml', 'und', 'paq', 'paca', 'caja', 'bolsa', 'sixpack']);

/**
 * Presentaciones de compra que requieren un factor de conversión configurado
 * por insumo ("1 paca de arroz = 20 kg"). No son unidades base de inventario.
 */
export const PRESENTACIONES_COMPRA = ['paq', 'paca', 'caja', 'bolsa', 'sixpack'];

/**
 * Tratamiento de IVA por línea (reemplaza el booleano global iva_incluido):
 * - 'incluido': el monto unitario ya trae el IVA (el más común).
 * - 'mas_iva':  el monto unitario es la base; el IVA se suma aparte.
 * - 'exento':   tarifa 0 %.
 */
export const MODOS_IVA = ['incluido', 'mas_iva', 'exento'];

/**
 * Normaliza cualquier entrada de modo de IVA a un valor de MODOS_IVA.
 * Acepta booleanos por retrocompatibilidad (true → 'incluido',
 * false → 'mas_iva'); null/undefined cae en 'incluido' (el valor por
 * defecto de cada ítem). Lanza 400 si el valor no es válido.
 */
export function normalizarModoIva(valor) {
  if (valor === true) return 'incluido';
  if (valor === false) return 'mas_iva';
  if (valor === undefined || valor === null || valor === '') return 'incluido';
  if (typeof valor === 'string' && MODOS_IVA.includes(valor.trim())) return valor.trim();
  throw new AppError(`El modo de IVA «${valor}» no es válido. Use: ${MODOS_IVA.join(', ')}.`, 400);
}

/**
 * Retrocompatibilidad (regla 2.1): si un ítem no trae `modo_iva`, se toma el
 * IVA global de la petición/registro (true → 'incluido', false → 'mas_iva')
 * y, si tampoco hay global, 'incluido'.
 */
export function resolverModoIva(item, ivaIncluidoGlobal) {
  const modo = item?.modo_iva;
  if (modo !== undefined && modo !== null && modo !== '') return normalizarModoIva(modo);
  if (typeof ivaIncluidoGlobal === 'boolean') return ivaIncluidoGlobal ? 'incluido' : 'mas_iva';
  return 'incluido';
}

/**
 * Dato derivado (regla 2.1): `tb_compras.iva_incluido` deja de ser obligatorio.
 * true si todas las líneas son 'incluido', false si todas son 'mas_iva' y
 * NULL si hay mezcla o alguna línea exenta.
 */
export function derivarIvaIncluidoGlobal(items, ivaIncluidoGlobal) {
  const lista = Array.isArray(items) ? items : [];
  if (!lista.length) {
    return typeof ivaIncluidoGlobal === 'boolean' ? ivaIncluidoGlobal : null;
  }
  const modos = lista.map((item) => resolverModoIva(item, ivaIncluidoGlobal));
  if (modos.every((modo) => modo === 'incluido')) return true;
  if (modos.every((modo) => modo === 'mas_iva')) return false;
  return null;
}

/**
 * Calcula base sin IVA, IVA y subtotal de una línea según su modo:
 * - 'incluido': subtotal = round(cant × precio);
 *               base = round(subtotal / (1 + iva/100)); iva$ = subtotal − base.
 * - 'mas_iva':  base = round(cant × precio); iva$ = round(base × iva/100);
 *               subtotal = base + iva$.
 * - 'exento':   iva forzado a 0; base = subtotal = round(cant × precio).
 *
 * El cuarto parámetro acepta también un booleano (retrocompatibilidad:
 * true → 'incluido', false → 'mas_iva'). Redondeo a 2 decimales, igual que
 * el frontend (`compras/services/iva.ts`).
 *
 * Identidad que siempre se cumple: base_sin_iva + monto_iva = subtotal.
 */
export function calcularImporteLinea(cantidad, precioUnitario, iva, modoIva = 'incluido') {
  const modo = normalizarModoIva(modoIva);
  const cantidadNumero = Number(cantidad);
  const precio = Number(precioUnitario);
  const tasa = modo === 'exento' ? 0 : Number(iva);

  if (modo === 'incluido') {
    const subtotal = redondearDosDecimales(cantidadNumero * precio);
    const baseSinIva = redondearDosDecimales(subtotal / (1 + tasa / 100));
    return {
      base_sin_iva: baseSinIva,
      monto_iva: redondearDosDecimales(subtotal - baseSinIva),
      subtotal,
    };
  }

  const baseSinIva = redondearDosDecimales(cantidadNumero * precio);
  const montoIva = redondearDosDecimales((baseSinIva * tasa) / 100);
  return {
    base_sin_iva: baseSinIva,
    monto_iva: montoIva,
    subtotal: redondearDosDecimales(baseSinIva + montoIva),
  };
}

/**
 * Convierte la cantidad comprada a la unidad base del insumo (lo que entra a
 * inventario), según la regla 2.2:
 *
 * - Caso A (medida directa): si `medida` es la unidad base o es convertible
 *   (kg↔g, lt↔ml), se usa la conversión actual.
 * - Caso B (empaque): si `medida` es una presentación (paq, paca, caja,
 *   bolsa, sixpack), se multiplica por `factorPresentacion` (cuántas unidades
 *   base trae cada presentación). Sin factor > 0 no se puede convertir.
 * - Insumos legados con `paq/caja/bolsa` como unidad base: si `medida` es
 *   igual a la unidad base, el factor es 1 (se trata como medida directa).
 *
 * @param {{cantidad: number|string, medida: string, unidadBase: string,
 *          factorPresentacion?: number|string|null, nombre?: string}} datos
 * @returns {number} cantidad en la unidad base del insumo.
 */
export function convertirABase({ cantidad, medida, unidadBase, factorPresentacion, nombre }) {
  const cantidadNumero = Number(cantidad);
  if (!Number.isFinite(cantidadNumero) || cantidadNumero <= 0) {
    throw new AppError('La cantidad debe ser un número mayor que cero.', 400);
  }

  const medidaLimpia = String(medida ?? '').trim();
  const baseLimpia = String(unidadBase ?? '').trim();
  if (!medidaLimpia || !baseLimpia) {
    throw new AppError('Se requiere la medida comprada y la unidad base del insumo para convertir la cantidad.', 400);
  }

  // Misma medida: unidad base directa (o insumo legado cuya "unidad base" es
  // en realidad una presentación → factor 1).
  if (medidaLimpia === baseLimpia) return cantidadNumero;

  // Caso B: presentación de compra → requiere factor configurado.
  if (PRESENTACIONES_COMPRA.includes(medidaLimpia)) {
    const factor = Number(factorPresentacion);
    if (!Number.isFinite(factor) || factor <= 0) {
      throw new AppError(
        `Falta el contenido de la presentación: indica cuántas ${baseLimpia} trae cada ${medidaLimpia}` +
          `${nombre ? ` de «${nombre}»` : ''}.`,
        400
      );
    }
    return cantidadNumero * factor;
  }

  // Caso A: conversión directa (kg↔g, lt↔ml). Si no es compatible,
  // convertirUnidad lanza un error 400 en español.
  return convertirUnidad(cantidadNumero, medidaLimpia, baseLimpia, nombre || 'el insumo');
}

export function convertirCantidadCompra(cantidad, medida, unidad, nombre) {
  return convertirUnidad(cantidad, medida, unidad, nombre);
}

/**
 * Precio unitario convertido a "con IVA" según el modo de la línea
 * (acepta booleano por retrocompatibilidad). Con 'exento' no se suma nada.
 */
export function costoUnitarioConIva(precioUnitario, iva, modoIva) {
  const precio = Number(precioUnitario);
  const modo = normalizarModoIva(modoIva);
  if (modo === 'incluido') return redondearDosDecimales(precio);
  const tasa = modo === 'exento' ? 0 : Number(iva);
  return redondearDosDecimales(precio * (1 + tasa / 100));
}
