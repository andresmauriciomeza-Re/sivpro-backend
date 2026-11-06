import AppError from '../errors/AppError.js';

export function partesPorPorcion(tamano) {
  if (tamano === 'Mediana') return 3;
  if (tamano === 'Grande') return 4;
  throw new AppError('Selecciona Mediana o Grande para la pizza.', 400);
}

export function partesPizza(cantidad, tamano) {
  const partes = cantidad * partesPorPorcion(tamano);
  if (!Number.isSafeInteger(partes) || partes < 0 || partes > 2147483647) {
    throw new AppError('La cantidad de porciones de pizza no es válida.', 400);
  }
  return partes;
}

export function errorStockPizza(nombre, stock) {
  const partes = Number(stock);
  return new AppError(`Solo alcanzan ${Math.floor(partes / 3)} porciones medianas o ${Math.floor(partes / 4)} grandes de ${nombre}`, 409);
}
