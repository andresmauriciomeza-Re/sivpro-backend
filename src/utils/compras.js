import { convertirUnidad, redondearDosDecimales } from './insumos.js';

export const UNIDADES_COMPRA = new Set(['kg', 'g', 'lt', 'ml', 'und', 'paq', 'paca', 'caja', 'bolsa']);

export function calcularImporteLinea(cantidad, precioUnitario, iva, ivaIncluido) {
  const cantidadNumero = Number(cantidad);
  const precio = Number(precioUnitario);
  const tasa = Number(iva);
  if (ivaIncluido) {
    const subtotal = redondearDosDecimales(cantidadNumero * precio);
    const baseSinIva = redondearDosDecimales(subtotal / (1 + tasa / 100));
    return {
      base_sin_iva: baseSinIva,
      monto_iva: redondearDosDecimales(subtotal - baseSinIva),
      subtotal,
    };
  }
  const baseSinIva = redondearDosDecimales(cantidadNumero * precio);
  const montoIva = redondearDosDecimales(baseSinIva * tasa / 100);
  return {
    base_sin_iva: baseSinIva,
    monto_iva: montoIva,
    subtotal: redondearDosDecimales(baseSinIva + montoIva),
  };
}

export function convertirCantidadCompra(cantidad, medida, unidad, nombre) {
  return convertirUnidad(cantidad, medida, unidad, nombre);
}

export function costoUnitarioConIva(precioUnitario, iva, ivaIncluido) {
  const precio = Number(precioUnitario);
  const tasa = Number(iva);
  return redondearDosDecimales(ivaIncluido ? precio : precio * (1 + tasa / 100));
}
