import AppError from '../errors/AppError.js';

const redondearArriba = (valor) => Math.ceil(valor / 100) * 100;
const minimoGrande = (mediana) => Math.ceil(Math.round(mediana * 1.1 * 1000) / 1000 / 100) * 100;

export function preciosRecomendadosPizza(costo, margen) {
  if (!Number.isFinite(costo) || costo <= 0 || !Number.isFinite(margen) || margen < 0) {
    throw new AppError('No se puede calcular el precio recomendado de la pizza con estos costos.', 409);
  }
  const mediana = redondearArriba((costo / 8) * (1 + margen / 100));
  const grande = Math.max(redondearArriba((costo / 6) * (1 + margen / 100)), minimoGrande(mediana));
  return { mediana, grande };
}

export function asignarPreciosPizza(costo, margen, precioMediana, precioGrande) {
  if (![precioMediana, precioGrande].every((valor) => Number.isFinite(valor) && valor >= 0)) {
    throw new AppError('Los precios actuales de la pizza no son válidos.', 409);
  }
  if (precioMediana > 0 && precioGrande > 0) {
    return { mediana: precioMediana, grande: precioGrande, asignados: [] };
  }
  const recomendados = preciosRecomendadosPizza(costo, margen);
  let mediana = precioMediana;
  let grande = precioGrande;
  if (mediana === 0 && grande === 0) {
    ({ mediana, grande } = recomendados);
  } else if (mediana === 0) {
    mediana = Math.min(recomendados.mediana, Math.floor((grande / 1.1 + 1e-9) / 100) * 100);
  } else if (grande === 0) {
    grande = Math.max(recomendados.grande, minimoGrande(mediana));
  }
  if (mediana <= 0 || grande <= mediana || grande + 1e-9 < mediana * 1.1) {
    throw new AppError('No se pueden asignar precios válidos sin modificar el precio existente de la pizza.', 409);
  }
  const asignados = [];
  if (precioMediana === 0) asignados.push({ tamano: 'Mediana', precio: mediana, porDebajoDelCosto: mediana < costo / 8 });
  if (precioGrande === 0) asignados.push({ tamano: 'Grande', precio: grande, porDebajoDelCosto: grande < costo / 6 });
  return { mediana, grande, asignados };
}
