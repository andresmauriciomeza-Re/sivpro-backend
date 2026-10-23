import AppError from '../errors/AppError.js';
import normalizarCategoria from '../utils/normalizarCategoria.js';

// Categorías originales (Pizza, Lasaña y Bebidas): el resto del backend
// reconoce su nombre (productos, ventas, fichas, producción), así que no
// cambian de nombre ni de ícono y no se eliminan.
export const CATEGORIAS_FIJAS = [1, 2, 3];

// Longitudes reales de tb_categoria_productos.
const MAX_NOMBRE = 50;
const MAX_EMOJI = 50;
const MAX_DESCRIPCION = 255;
// Clave "img:…" del catálogo de imágenes del frontend (imagenesCategoria.ts).
const FORMATO_ICONO = /^img:[a-z0-9-]+$/;

const CAMPOS = ['nombre', 'emoji', 'descripcion', 'estado'];

/** Clave de comparación del nombre: sin tildes, sin mayúsculas y sin
 *  espacios de más ("PÓLLO " y "pollo" son el mismo nombre). */
export const claveNombreCategoria = (nombre) => normalizarCategoria(nombre).replace(/\s+/g, ' ');

function cuerpo(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError('La solicitud no es válida.', 400);
  }
  return body;
}

function soloCampos(body, permitidos) {
  const extra = Object.keys(body).filter((campo) => !permitidos.includes(campo));
  if (extra.length) throw new AppError(`Campos no permitidos: ${extra.join(', ')}.`, 400);
}

function enteroPositivo(valor, campo) {
  const resultado = typeof valor === 'string' && valor.trim() ? Number(valor) : valor;
  if (typeof resultado !== 'number' || !Number.isSafeInteger(resultado) || resultado <= 0) {
    throw new AppError(`El campo ${campo} debe ser un entero mayor que cero.`, 400);
  }
  return resultado;
}

function nombre(valor) {
  if (typeof valor !== 'string' || !valor.trim()) throw new AppError('El nombre es obligatorio', 400);
  const limpio = valor.trim().replace(/\s+/g, ' ');
  if (limpio.length > MAX_NOMBRE) {
    throw new AppError(`El nombre no puede superar ${MAX_NOMBRE} caracteres`, 400);
  }
  return limpio;
}

function icono(valor) {
  if (typeof valor !== 'string' || valor.length > MAX_EMOJI || !FORMATO_ICONO.test(valor)) {
    throw new AppError('Selecciona una imagen válida.', 400);
  }
  return valor;
}

function descripcion(valor) {
  if (valor == null || valor === '') return null;
  if (typeof valor !== 'string') throw new AppError('La descripción no es válida.', 400);
  if (valor.trim().length > MAX_DESCRIPCION) {
    throw new AppError(`La descripción no puede superar ${MAX_DESCRIPCION} caracteres.`, 400);
  }
  return valor.trim() || null;
}

function estado(valor) {
  if (typeof valor !== 'boolean') throw new AppError('El estado debe ser verdadero o falso.', 400);
  return valor;
}

export function validarIdCategoria(valor) {
  return enteroPositivo(valor, 'id');
}

/** POST: nombre e ícono obligatorios; descripción opcional; Activa por defecto. */
export function validarCrearCategoria(body) {
  const entrada = cuerpo(body);
  soloCampos(entrada, CAMPOS);
  return {
    nombre: nombre(entrada.nombre),
    emoji: icono(entrada.emoji),
    descripcion: descripcion(entrada.descripcion),
    estado: entrada.estado === undefined ? true : estado(entrada.estado),
  };
}

/** PUT: los mismos campos, todos opcionales (al menos uno). Las originales
 *  envían solo descripción y estado; el servicio rechaza otro cambio. */
export function validarEditarCategoria(body) {
  const entrada = cuerpo(body);
  soloCampos(entrada, CAMPOS);
  const datos = {};
  if (entrada.nombre !== undefined) datos.nombre = nombre(entrada.nombre);
  if (entrada.emoji !== undefined) datos.emoji = icono(entrada.emoji);
  if (entrada.descripcion !== undefined) datos.descripcion = descripcion(entrada.descripcion);
  if (entrada.estado !== undefined) datos.estado = estado(entrada.estado);
  if (!Object.keys(datos).length) throw new AppError('No se envió ningún cambio.', 400);
  return datos;
}

/** PATCH /estado: { estado: true | false }. */
export function validarEstadoCategoria(body) {
  const entrada = cuerpo(body);
  soloCampos(entrada, ['estado']);
  return estado(entrada.estado);
}
