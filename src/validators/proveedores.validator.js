import AppError from '../errors/AppError.js';
import { fechaHoraBogota } from '../utils/produccion.js';

const TIPOS_DOCUMENTO = ['CC', 'CE', 'Pasaporte'];
const TIPOS_SOCIEDAD = ['S.A.S.', 'S.A.', 'Ltda.', 'Fundación', 'S.C.', 'Otra'];

function texto(valor, campo, max) {
  if (typeof valor !== 'string' || !valor.trim() || valor.trim().length > max) {
    throw new AppError(`El campo ${campo} es obligatorio y no puede superar ${max} caracteres.`, 400);
  }
  return valor.trim();
}

function opcional(valor) {
  if (valor == null || (typeof valor === 'string' && !valor.trim())) return null;
  if (typeof valor !== 'string') throw new AppError('Los campos opcionales deben ser texto.', 400);
  return valor.trim();
}

function validarDigitos(valor, campo, max, min = 1) {
  const resultado = texto(valor, campo, max);
  if (!/^\d+$/.test(resultado) || resultado.length < min) {
    throw new AppError(`El campo ${campo} debe contener entre ${min} y ${max} dígitos.`, 400);
  }
  return resultado;
}

function validarFecha(valor) {
  if (valor == null || valor === '') return null;
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    throw new AppError('La fecha de expedición debe tener formato YYYY-MM-DD.', 400);
  }
  const [anio, mes, dia] = valor.split('-').map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  if (fecha.toISOString().slice(0, 10) !== valor) throw new AppError('La fecha de expedición no es válida.', 400);
  if (valor > fechaHoraBogota().fecha) throw new AppError('La fecha de expedición no puede ser futura.', 400);
  return valor;
}

function validarUrl(valor) {
  const url = opcional(valor);
  if (url == null) return null;
  if (url.length > 255) throw new AppError('El campo camara_comercio no puede superar 255 caracteres.', 400);
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('protocol');
  } catch {
    throw new AppError('El campo camara_comercio debe ser una URL válida.', 400);
  }
  return url;
}

function validarCorreo(valor) {
  const correo = texto(valor, 'email', 100).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) throw new AppError('El correo electrónico no es válido.', 400);
  return correo;
}

function validarTipoPersona(valor) {
  if (!['Natural', 'Juridica'].includes(valor)) throw new AppError("tipo_persona debe ser 'Natural' o 'Juridica'.", 400);
  return valor;
}

function campoNoAplicable(valor, campo) {
  if (opcional(valor) != null) throw new AppError(`El campo ${campo} no aplica para este tipo de persona.`, 400);
  return null;
}

export function validarIdProveedor(valor) {
  const id = Number(valor);
  if (!Number.isSafeInteger(id) || id <= 0) throw new AppError('El id de proveedor no es válido.', 400);
  return id;
}

export function validarCrearProveedor(body) {
  const entrada = body || {};
  const tipo_persona = validarTipoPersona(entrada.tipo_persona);
  const nit = validarDigitos(entrada.nit, 'nit', 15, 6);
  const dv = opcional(entrada.dv);
  if (tipo_persona === 'Juridica' && dv == null) throw new AppError('El DV es obligatorio para una persona jurídica.', 400);
  if (dv != null && !/^\d$/.test(dv)) throw new AppError('El DV debe ser un solo dígito.', 400);

  const datos = {
    tipo_persona,
    nit,
    dv,
    nombre: texto(entrada.nombre, 'nombre', 100),
    asesor_comercial: texto(entrada.asesor_comercial, 'asesor_comercial', 50),
    telefono: validarDigitos(entrada.telefono, 'telefono', 20, 7),
    email: validarCorreo(entrada.email),
    direccion: texto(entrada.direccion, 'direccion', 100),
  };

  if (tipo_persona === 'Natural') {
    const tipoDocumento = texto(entrada.tipo_documento, 'tipo_documento', 10);
    if (!TIPOS_DOCUMENTO.includes(tipoDocumento)) throw new AppError('El tipo_documento no es válido.', 400);
    datos.tipo_documento = tipoDocumento;
    datos.numero_documento = validarDigitos(entrada.numero_documento, 'numero_documento', 15);
    datos.tipo_sociedad = campoNoAplicable(entrada.tipo_sociedad, 'tipo_sociedad');
    datos.camara_comercio = campoNoAplicable(entrada.camara_comercio, 'camara_comercio');
    datos.fecha_exp_camara = campoNoAplicable(entrada.fecha_exp_camara, 'fecha_exp_camara');
    datos.rep_legal_nombre = campoNoAplicable(entrada.rep_legal_nombre, 'rep_legal_nombre');
    datos.rep_legal_tipo_doc = campoNoAplicable(entrada.rep_legal_tipo_doc, 'rep_legal_tipo_doc');
    datos.rep_legal_num_doc = campoNoAplicable(entrada.rep_legal_num_doc, 'rep_legal_num_doc');
  } else {
    datos.tipo_documento = campoNoAplicable(entrada.tipo_documento, 'tipo_documento');
    datos.numero_documento = campoNoAplicable(entrada.numero_documento, 'numero_documento');
    const sociedad = texto(entrada.tipo_sociedad, 'tipo_sociedad', 20);
    if (!TIPOS_SOCIEDAD.includes(sociedad)) throw new AppError('El tipo_sociedad no es válido.', 400);
    datos.tipo_sociedad = sociedad;
    datos.camara_comercio = validarUrl(entrada.camara_comercio);
    datos.fecha_exp_camara = validarFecha(entrada.fecha_exp_camara);
    datos.rep_legal_nombre = texto(entrada.rep_legal_nombre, 'rep_legal_nombre', 100);
    const tipoRep = texto(entrada.rep_legal_tipo_doc, 'rep_legal_tipo_doc', 10);
    if (!TIPOS_DOCUMENTO.includes(tipoRep)) throw new AppError('El tipo de documento del representante legal no es válido.', 400);
    datos.rep_legal_tipo_doc = tipoRep;
    datos.rep_legal_num_doc = validarDigitos(entrada.rep_legal_num_doc, 'rep_legal_num_doc', 15);
  }
  return datos;
}

export function validarEditarProveedor(body, tipoPersonaActual) {
  const entrada = body || {};
  if (entrada.tipo_persona !== undefined && entrada.tipo_persona !== tipoPersonaActual) {
    throw new AppError('El tipo_persona del proveedor no se puede cambiar.', 400);
  }
  return validarCrearProveedor({ ...entrada, tipo_persona: tipoPersonaActual });
}

export function validarEstadoProveedor(body) {
  if (typeof body?.estado !== 'boolean') throw new AppError('El estado debe ser booleano.', 400);
  return body.estado;
}

export function validarFiltroEstado(query) {
  if (query.estado === undefined) return undefined;
  if (!['true', 'false'].includes(query.estado)) throw new AppError("El filtro estado debe ser 'true' o 'false'.", 400);
  return query.estado === 'true';
}
