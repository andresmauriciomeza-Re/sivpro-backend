import AppError from '../errors/AppError.js';
import { fechaHoraBogota } from '../utils/produccion.js';

// Valores de los CHECK de tb_productos_no_conformes.
export const ESTADOS_PNC = ['Pendiente', 'Completado'];
export const TIPOS_PNC = ['Producto', 'Producto insumo', 'Venta'];
export const TIPOS_SOLUCION_PNC = ['Reposicion', 'Reproceso', 'Reembolso'];
// Los registros de tipo 'Venta' los crea el backend al resolver una
// devolución; a mano solo se registran productos y productos insumo.
const TIPOS_MANUALES = ['Producto', 'Producto insumo'];
// Motivo reservado para la merma que registra Orden de Producción.
export const MOTIVO_MERMA = 'Merma de cocina';

const MAX_TEXTO_LARGO = 2000;
const PREFIJO_CLOUDINARY = 'https://res.cloudinary.com/';

// Campos que el frontend puede enviar al crear y al editar (lista blanca).
const CAMPOS_CREAR = [
  'tipo_no_conformidad', 'id_producto', 'id_insumo', 'id_orden_produccion', 'id_venta',
  'fecha_registro', 'cantidad_afectada', 'motivo', 'descripcion_detallada', 'categoria',
  'causa', 'area_proceso', 'proveedor', 'lote', 'responsable', 'accion_tomada',
  'accion_correctiva', 'fecha_limite', 'responsable_accion', 'tipo_solucion',
  'solucion_aplicada', 'foto_evidencia',
];
const CAMPOS_EDITAR = [
  'descripcion_detallada', 'categoria', 'causa', 'area_proceso', 'proveedor', 'lote',
  'responsable', 'accion_tomada', 'accion_correctiva', 'fecha_limite', 'responsable_accion',
  'tipo_solucion', 'solucion_aplicada', 'foto_evidencia',
];

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

function enteroOpcional(valor, campo) {
  if (valor == null || valor === '') return null;
  return enteroPositivo(valor, campo);
}

function textoObligatorio(valor, campo, max) {
  if (typeof valor !== 'string' || !valor.trim()) throw new AppError(`El campo ${campo} es obligatorio.`, 400);
  if (valor.trim().length > max) throw new AppError(`El campo ${campo} no puede superar ${max} caracteres.`, 400);
  return valor.trim();
}

function textoOpcional(valor, campo, max) {
  if (valor == null || valor === '') return null;
  if (typeof valor !== 'string' || valor.trim().length > max) {
    throw new AppError(`El campo ${campo} no puede superar ${max} caracteres.`, 400);
  }
  return valor.trim() || null;
}

function fecha(valor, campo) {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    throw new AppError(`El campo ${campo} debe tener formato YYYY-MM-DD.`, 400);
  }
  const [anio, mes, dia] = valor.split('-').map(Number);
  const real = new Date(Date.UTC(anio, mes - 1, dia));
  if (real.toISOString().slice(0, 10) !== valor) throw new AppError(`El campo ${campo} no es una fecha válida.`, 400);
  return valor;
}

function fechaOpcional(valor, campo) {
  if (valor == null || valor === '') return null;
  return fecha(valor, campo);
}

function tipoSolucion(valor) {
  if (valor == null || valor === '') return null;
  if (!TIPOS_SOLUCION_PNC.includes(valor)) {
    throw new AppError("El tipo de solución debe ser 'Reposicion', 'Reproceso' o 'Reembolso'.", 400);
  }
  return valor;
}

function fotoEvidencia(valor) {
  if (valor == null || valor === '') return null;
  if (typeof valor !== 'string' || !valor.startsWith(PREFIJO_CLOUDINARY)) {
    throw new AppError('La foto de evidencia debe ser una imagen subida al sistema.', 400);
  }
  if (valor.length > 255) throw new AppError('La URL de la foto de evidencia supera 255 caracteres.', 400);
  return valor;
}

/** Campos de texto comunes a crear y editar, con las longitudes reales de la tabla. */
function camposComunes(body) {
  return {
    descripcion_detallada: textoOpcional(body.descripcion_detallada, 'descripcion_detallada', 500),
    categoria: textoOpcional(body.categoria, 'categoria', 100),
    causa: textoOpcional(body.causa, 'causa', MAX_TEXTO_LARGO),
    area_proceso: textoOpcional(body.area_proceso, 'area_proceso', 50),
    proveedor: textoOpcional(body.proveedor, 'proveedor', 150),
    lote: textoOpcional(body.lote, 'lote', 50),
    responsable: textoOpcional(body.responsable, 'responsable', 150),
    accion_tomada: textoOpcional(body.accion_tomada, 'accion_tomada', MAX_TEXTO_LARGO),
    accion_correctiva: textoOpcional(body.accion_correctiva, 'accion_correctiva', MAX_TEXTO_LARGO),
    fecha_limite: fechaOpcional(body.fecha_limite, 'fecha_limite'),
    responsable_accion: textoOpcional(body.responsable_accion, 'responsable_accion', 150),
    tipo_solucion: tipoSolucion(body.tipo_solucion),
    solucion_aplicada: textoOpcional(body.solucion_aplicada, 'solucion_aplicada', 500),
    foto_evidencia: fotoEvidencia(body.foto_evidencia),
  };
}

export function validarIdProductoNoConforme(valor) {
  return enteroPositivo(valor, 'id');
}

export function validarFiltrosProductosNoConformes(query) {
  const filtros = {};
  if (query?.estado !== undefined && query.estado !== '') {
    if (!ESTADOS_PNC.includes(query.estado)) throw new AppError("El filtro estado debe ser 'Pendiente' o 'Completado'.", 400);
    filtros.estado = query.estado;
  }
  if (query?.tipo !== undefined && query.tipo !== '') {
    if (!TIPOS_PNC.includes(query.tipo)) throw new AppError("El filtro tipo debe ser 'Producto', 'Producto insumo' o 'Venta'.", 400);
    filtros.tipo = query.tipo;
  }
  return filtros;
}

/** POST: registro manual (tipo Producto o Producto insumo). El nombre y la
 *  unidad salen del catálogo en el servicio, no del cliente. */
export function validarCrearProductoNoConforme(body) {
  const entrada = cuerpo(body);
  soloCampos(entrada, CAMPOS_CREAR);

  const tipo = entrada.tipo_no_conformidad;
  if (!TIPOS_MANUALES.includes(tipo)) {
    throw new AppError("El tipo debe ser 'Producto' o 'Producto insumo'.", 400);
  }
  const idProducto = enteroOpcional(entrada.id_producto, 'id_producto');
  const idInsumo = enteroOpcional(entrada.id_insumo, 'id_insumo');
  if (tipo === 'Producto' && (!idProducto || idInsumo)) {
    throw new AppError('Un registro de tipo Producto necesita id_producto (y no id_insumo).', 400);
  }
  if (tipo === 'Producto insumo' && (!idInsumo || idProducto)) {
    throw new AppError('Un registro de tipo Producto insumo necesita id_insumo (y no id_producto).', 400);
  }

  const hoy = fechaHoraBogota().fecha;
  const fechaRegistro = entrada.fecha_registro == null || entrada.fecha_registro === ''
    ? hoy
    : fecha(entrada.fecha_registro, 'fecha_registro');
  if (fechaRegistro > hoy) throw new AppError('La fecha de registro no puede ser futura.', 400);

  const cantidad = numero(entrada.cantidad_afectada, 'cantidad_afectada');
  if (cantidad <= 0) throw new AppError('La cantidad afectada debe ser mayor que cero.', 400);

  const motivo = textoObligatorio(entrada.motivo, 'motivo', 100);
  if (motivo.toLowerCase() === MOTIVO_MERMA.toLowerCase()) {
    throw new AppError(`El motivo «${MOTIVO_MERMA}» lo registra Orden de Producción al completar una orden.`, 400);
  }

  const datos = {
    tipo_no_conformidad: tipo,
    id_producto: idProducto,
    id_insumo: idInsumo,
    id_orden_produccion: enteroOpcional(entrada.id_orden_produccion, 'id_orden_produccion'),
    id_venta: enteroOpcional(entrada.id_venta, 'id_venta'),
    fecha_registro: fechaRegistro,
    cantidad_afectada: cantidad,
    motivo,
    ...camposComunes(entrada),
  };
  if (datos.tipo_solucion === 'Reembolso' && !datos.id_venta) {
    throw new AppError('El reembolso solo aplica cuando hay una venta relacionada.', 400);
  }
  return datos;
}

/** PUT: solo los campos descriptivos y de solución (nunca tipo, producto,
 *  cantidad ni estado: eso movería stock o cerraría el registro). */
export function validarEditarProductoNoConforme(body) {
  const entrada = cuerpo(body);
  soloCampos(entrada, CAMPOS_EDITAR);
  return camposComunes(entrada);
}

/** PATCH /estado: cierre del registro con su solución. */
export function validarCompletarProductoNoConforme(body) {
  const entrada = cuerpo(body);
  soloCampos(entrada, ['estado', 'tipo_solucion', 'solucion_aplicada']);
  if (entrada.estado !== 'Completado') {
    throw new AppError("El único cambio de estado permitido es a 'Completado'.", 400);
  }
  const solucion = tipoSolucion(entrada.tipo_solucion);
  if (!solucion) throw new AppError('Elige el tipo de solución para completar el registro.', 400);
  return {
    tipo_solucion: solucion,
    solucion_aplicada: textoObligatorio(entrada.solucion_aplicada, 'solucion_aplicada', 500),
  };
}
