import AppError from '../errors/AppError.js';
import { normalizarNombreInsumo, UNIDADES_INSUMO } from '../utils/insumos.js';

const TIPOS_INSUMO = ['Insumo', 'Producto insumo'];

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

function validarNombre(valor) {
  const nombre = normalizarNombreInsumo(valor);
  if (nombre.length < 2 || nombre.length > 100) {
    throw new AppError('El nombre debe tener entre 2 y 100 caracteres.', 400);
  }
  return nombre;
}

function validarUnidad(valor, campo = 'unidad_medida') {
  if (typeof valor !== 'string' || !UNIDADES_INSUMO.includes(valor.trim())) {
    throw new AppError(`El campo ${campo} debe ser una unidad válida (${UNIDADES_INSUMO.join(', ')}).`, 400);
  }
  return valor.trim();
}

function validarDescripcion(valor) {
  if (valor == null || valor === '') return null;
  if (typeof valor !== 'string' || valor.length > 255) {
    throw new AppError('El campo descripcion debe ser texto y no superar 255 caracteres.', 400);
  }
  return valor.trim() || null;
}

function validarLineasFicha(lineas) {
  if (!Array.isArray(lineas) || lineas.length === 0) {
    throw new AppError('La ficha técnica debe incluir al menos un insumo.', 400);
  }
  const vistos = new Set();
  return lineas.map((linea, indice) => {
    const id_insumo = enteroPositivo(linea?.id_insumo, `insumos[${indice}].id_insumo`);
    if (vistos.has(id_insumo)) throw new AppError('No repitas insumos en la ficha técnica.', 400);
    vistos.add(id_insumo);
    return {
      id_insumo,
      cantidad: numeroPositivo(linea?.cantidad, `insumos[${indice}].cantidad`),
      medida: validarUnidad(linea?.medida, `insumos[${indice}].medida`),
    };
  });
}

function numeroPositivo(valor, campo) {
  const resultado = numero(valor, campo);
  if (resultado <= 0) throw new AppError(`El campo ${campo} debe ser mayor que cero.`, 400);
  return resultado;
}

function validarPasos(valor) {
  if (valor === undefined || valor === null) return null;
  if (!Array.isArray(valor) || valor.some((paso) => typeof paso !== 'string')) {
    throw new AppError('El campo pasos debe ser un arreglo de textos.', 400);
  }
  return valor;
}

export function validarIdInsumo(valor) {
  return enteroPositivo(valor, 'id_insumo');
}

export function validarCrearInsumo(body) {
  const entrada = body || {};
  const tipo = entrada.tipo;
  if (!TIPOS_INSUMO.includes(tipo)) throw new AppError("El tipo debe ser 'Insumo' o 'Producto insumo'.", 400);
  if (entrada.crear_orden_produccion !== undefined && typeof entrada.crear_orden_produccion !== 'boolean') {
    throw new AppError('El campo crear_orden_produccion debe ser booleano.', 400);
  }
  if (entrada.crear_orden_produccion === true && tipo !== 'Producto insumo') {
    throw new AppError('Solo un Producto insumo puede crear una orden de producción al registrarse.', 400);
  }

  const datos = {
    nombre: validarNombre(entrada.nombre),
    tipo,
    crear_orden_produccion: entrada.crear_orden_produccion === true,
    id_categoria_insumo: enteroPositivo(entrada.id_categoria_insumo, 'id_categoria_insumo'),
    unidad_medida: validarUnidad(entrada.unidad_medida),
    stock_minimo: entrada.stock_minimo === undefined ? 0 : numero(entrada.stock_minimo, 'stock_minimo'),
    descripcion: validarDescripcion(entrada.descripcion),
  };
  if (datos.stock_minimo < 0) throw new AppError('El stock_minimo no puede ser negativo.', 400);

  if (tipo === 'Insumo') {
    datos.costo_unitario = entrada.costo_unitario === undefined ? 0 : numero(entrada.costo_unitario, 'costo_unitario');
    datos.iva = entrada.iva === undefined ? 0 : numero(entrada.iva, 'iva');
    if (datos.costo_unitario < 0) throw new AppError('El costo_unitario no puede ser negativo.', 400);
    if (datos.iva < 0 || datos.iva > 100) throw new AppError('El iva debe estar entre 0 y 100.', 400);
    return datos;
  }

  datos.costo_unitario = 0;
  datos.iva = 0;
  datos.ficha = validarFichaProductoInsumo(entrada.ficha, datos.unidad_medida);
  return datos;
}

export function validarFichaProductoInsumo(valor, unidadMedida) {
  const entrada = valor || {};
  const tiempo_preparacion = enteroPositivo(entrada.tiempo_preparacion, 'ficha.tiempo_preparacion');
  return {
    cantidad: numeroPositivo(entrada.cantidad, 'ficha.cantidad'),
    medida: unidadMedida,
    porciones: null,
    tiempo_preparacion,
    pasos: validarPasos(entrada.pasos),
    insumos: validarLineasFicha(entrada.insumos),
  };
}

export function validarEditarInsumo(body) {
  const entrada = body || {};
  const datos = {};
  if (entrada.nombre !== undefined) datos.nombre = validarNombre(entrada.nombre);
  if (entrada.tipo !== undefined) {
    if (!TIPOS_INSUMO.includes(entrada.tipo)) throw new AppError("El tipo debe ser 'Insumo' o 'Producto insumo'.", 400);
    datos.tipo = entrada.tipo;
  }
  if (entrada.id_categoria_insumo !== undefined) {
    datos.id_categoria_insumo = enteroPositivo(entrada.id_categoria_insumo, 'id_categoria_insumo');
  }
  if (entrada.unidad_medida !== undefined) datos.unidad_medida = validarUnidad(entrada.unidad_medida);
  if (entrada.stock_minimo !== undefined) {
    datos.stock_minimo = numero(entrada.stock_minimo, 'stock_minimo');
    if (datos.stock_minimo < 0) throw new AppError('El stock_minimo no puede ser negativo.', 400);
  }
  if (entrada.descripcion !== undefined) datos.descripcion = validarDescripcion(entrada.descripcion);
  if (entrada.costo_unitario !== undefined) {
    datos.costo_unitario = numero(entrada.costo_unitario, 'costo_unitario');
    if (datos.costo_unitario < 0) throw new AppError('El costo_unitario no puede ser negativo.', 400);
  }
  if (entrada.iva !== undefined) {
    datos.iva = numero(entrada.iva, 'iva');
    if (datos.iva < 0 || datos.iva > 100) throw new AppError('El iva debe estar entre 0 y 100.', 400);
  }
  return datos;
}

export function validarEstadoInsumo(body) {
  if (typeof body?.estado !== 'boolean') throw new AppError('El estado debe ser booleano.', 400);
  return body.estado;
}

export function validarFiltrosInsumos(query) {
  const filtros = {};
  if (query.tipo !== undefined) {
    if (!TIPOS_INSUMO.includes(query.tipo)) throw new AppError("El filtro tipo debe ser 'Insumo' o 'Producto insumo'.", 400);
    filtros.tipo = query.tipo;
  }
  if (query.estado !== undefined) {
    if (!['true', 'false'].includes(query.estado)) throw new AppError("El filtro estado debe ser 'true' o 'false'.", 400);
    filtros.estado = query.estado === 'true';
  }
  return filtros;
}
