import AppError from '../errors/AppError.js';
import { UNIDADES_INSUMO } from '../utils/insumos.js';
import { validarIdInsumo } from './insumos.validator.js';

function numero(valor, campo) {
  if (valor === undefined || valor === null || typeof valor === 'boolean' || (typeof valor === 'string' && !valor.trim())) {
    throw new AppError(`El campo ${campo} debe ser un número.`, 400);
  }
  const resultado = Number(valor);
  if (!Number.isFinite(resultado)) throw new AppError(`El campo ${campo} debe ser un número.`, 400);
  return resultado;
}

function enteroPositivo(valor, campo) {
  const resultado = numero(valor, campo);
  if (!Number.isSafeInteger(resultado) || resultado <= 0) {
    throw new AppError(`El campo ${campo} debe ser un entero mayor que cero.`, 400);
  }
  return resultado;
}

function validarPasos(valor) {
  if (valor === undefined || valor === null) return null;
  if (!Array.isArray(valor) || valor.some((paso) => typeof paso !== 'string')) {
    throw new AppError('El campo pasos debe ser un arreglo de textos.', 400);
  }
  return valor;
}

function validarLineas(valor) {
  if (!Array.isArray(valor) || valor.length === 0) {
    throw new AppError('La ficha técnica debe incluir al menos un insumo.', 400);
  }
  const vistos = new Set();
  return valor.map((linea, indice) => {
    const id_insumo = validarIdInsumo(linea?.id_insumo);
    if (vistos.has(id_insumo)) throw new AppError('No repitas insumos en la ficha técnica.', 400);
    vistos.add(id_insumo);
    const medida = linea?.medida;
    if (typeof medida !== 'string' || !UNIDADES_INSUMO.includes(medida.trim())) {
      throw new AppError(`La medida del insumo ${indice + 1} no es válida.`, 400);
    }
    const cantidad = numero(linea?.cantidad, `insumos[${indice}].cantidad`);
    if (cantidad <= 0) throw new AppError(`La cantidad del insumo ${indice + 1} debe ser mayor que cero.`, 400);
    return { id_insumo, cantidad, medida: medida.trim() };
  });
}

export function validarConsultaFichas(query) {
  const tieneProducto = query.id_producto !== undefined;
  const tieneInsumo = query.id_insumo !== undefined;
  if (tieneProducto === tieneInsumo) {
    throw new AppError('Indica exactamente uno de los parámetros id_producto o id_insumo.', 400);
  }
  if (tieneProducto) return { id_producto: enteroPositivo(query.id_producto, 'id_producto') };
  return { id_insumo: validarIdInsumo(query.id_insumo) };
}

export function validarCrearFicha(body) {
  const entrada = body || {};
  const tieneProducto = entrada.id_producto !== undefined && entrada.id_producto !== null;
  const tieneInsumo = entrada.id_insumo !== undefined && entrada.id_insumo !== null;
  if (tieneProducto === tieneInsumo) {
    throw new AppError('Indica exactamente uno de los campos id_producto o id_insumo.', 400);
  }

  const medida = entrada.medida;
  if (typeof medida !== 'string' || !UNIDADES_INSUMO.includes(medida.trim())) {
    throw new AppError('El campo medida no es válido.', 400);
  }
  const datos = {
    id_producto: tieneProducto ? enteroPositivo(entrada.id_producto, 'id_producto') : null,
    id_insumo: tieneInsumo ? validarIdInsumo(entrada.id_insumo) : null,
    cantidad: numero(entrada.cantidad, 'cantidad'),
    medida: medida.trim(),
    porciones: entrada.porciones == null || entrada.porciones === '' ? null : enteroPositivo(entrada.porciones, 'porciones'),
    tiempo_preparacion: entrada.tiempo_preparacion == null || entrada.tiempo_preparacion === ''
      ? null
      : enteroPositivo(entrada.tiempo_preparacion, 'tiempo_preparacion'),
    pasos: validarPasos(entrada.pasos),
    insumos: validarLineas(entrada.insumos),
  };
  if (datos.cantidad <= 0) throw new AppError('El campo cantidad debe ser mayor que cero.', 400);
  return datos;
}
