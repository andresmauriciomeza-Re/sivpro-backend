import AppError from '../errors/AppError.js';
import { fechaHoraBogota } from '../utils/produccion.js';

const TIPOS_DOCUMENTO = ['CC', 'CE', 'Pasaporte'];
const TIPOS_SOCIEDAD = ['S.A.S.', 'S.A.', 'Ltda.', 'Fundación', 'S.C.', 'Otra'];
const PREFIJO_DOCUMENTO = {
  CC: 'CC',
  CE: 'CE',
  Pasaporte: 'PA',
};
const PESOS_DV_DIAN = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];

export function calcularDvNit(nitSinDv) {
  const digitos = String(nitSinDv ?? '').replace(/\D/g, '');
  if (!digitos || digitos.length > PESOS_DV_DIAN.length) return '';
  let suma = 0;
  for (let i = 0; i < digitos.length; i += 1) {
    suma += Number(digitos[digitos.length - 1 - i]) * PESOS_DV_DIAN[i];
  }
  const r = suma % 11;
  return String(r > 1 ? 11 - r : r);
}

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

function validarTelefono(valor, campo, max = 20, min = 7) {
  const textoValor = texto(valor, campo, 30);
  if (/[^\d\s\-()+]/.test(textoValor)) {
    throw new AppError(`El campo ${campo} debe contener entre ${min} y ${max} dígitos.`, 400);
  }
  const soloDigitos = textoValor.replace(/\D/g, '');
  if (!/^\d+$/.test(soloDigitos) || soloDigitos.length < min || soloDigitos.length > max) {
    throw new AppError(`El campo ${campo} debe contener entre ${min} y ${max} dígitos.`, 400);
  }
  return soloDigitos;
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

function validarCorreo(valor, campo = 'email') {
  const correo = texto(valor, campo, 100).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
    throw new AppError(
      campo === 'email' ? 'El correo electrónico no es válido.' : `El campo ${campo} no tiene un correo electrónico válido.`,
      400
    );
  }
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

function resolverNitJuridica(nitEntrada, dvEntrada) {
  const limpio = texto(nitEntrada, 'nit', 20).replace(/\D/g, '');
  const dvOpcional = opcional(dvEntrada);
  if (dvOpcional != null && !/^\d$/.test(dvOpcional)) {
    throw new AppError('El DV debe ser un solo dígito.', 400);
  }

  if (limpio.length === 10) {
    const base9 = limpio.slice(0, 9);
    const dvEnNit = limpio[9];
    const dvEsperado = calcularDvNit(base9);
    if (dvEnNit !== dvEsperado) {
      throw new AppError(`El dígito de verificación no corresponde al NIT (debería terminar en ${dvEsperado}).`, 400);
    }
    if (dvOpcional != null && dvOpcional !== dvEsperado) {
      throw new AppError(`El dígito de verificación no corresponde al NIT (debería ser ${dvEsperado}).`, 400);
    }
    return { nit: limpio, dv: dvEsperado };
  }

  if (limpio.length === 9) {
    const dvEsperado = calcularDvNit(limpio);
    if (dvOpcional != null && dvOpcional !== dvEsperado) {
      throw new AppError(`El dígito de verificación no corresponde al NIT (debería ser ${dvEsperado}).`, 400);
    }
    return { nit: `${limpio}${dvEsperado}`, dv: dvEsperado };
  }

  throw new AppError('El campo nit debe contener 10 dígitos (9 del NIT + 1 del dígito de verificación).', 400);
}

export function validarIdProveedor(valor) {
  const id = Number(valor);
  if (!Number.isSafeInteger(id) || id <= 0) throw new AppError('El id de proveedor no es válido.', 400);
  return id;
}

export function validarCrearProveedor(body, opciones = {}) {
  const entrada = body || {};
  const tipo_persona = validarTipoPersona(entrada.tipo_persona);
  const nombre = texto(entrada.nombre, 'nombre', 100);
  const asesorRaw = opcional(entrada.asesor_comercial);
  const asesor_comercial =
    tipo_persona === 'Natural' && !asesorRaw
      ? nombre.slice(0, 50)
      : texto(entrada.asesor_comercial, 'asesor_comercial', 50);

  const datos = {
    tipo_persona,
    nit: '',
    dv: null,
    nombre,
    nombre_comercial: null,
    asesor_comercial,
    telefono: validarTelefono(entrada.telefono, 'telefono', 20, 7),
    contacto_telefono_fijo: null,
    email: validarCorreo(entrada.email, 'email'),
    direccion: texto(entrada.direccion, 'direccion', 100),
  };

  if (entrada.estado !== undefined) {
    if (typeof entrada.estado !== 'boolean') throw new AppError('El estado debe ser booleano.', 400);
    datos.estado = entrada.estado;
  }

  if (tipo_persona === 'Natural') {
    const tipoDocumento = texto(entrada.tipo_documento, 'tipo_documento', 10);
    if (!TIPOS_DOCUMENTO.includes(tipoDocumento)) throw new AppError('El tipo_documento no es válido.', 400);
    const numeroDocumento = validarDigitos(entrada.numero_documento, 'numero_documento', 15, 5);
    const prefijo = PREFIJO_DOCUMENTO[tipoDocumento] || 'CC';
    const nitConPrefijo = `${prefijo}-${numeroDocumento}`;
    if (nitConPrefijo.length > 20) {
      throw new AppError('El número de documento con prefijo supera los 20 caracteres permitidos.', 400);
    }

    datos.tipo_documento = tipoDocumento;
    datos.numero_documento = numeroDocumento;
    datos.nit = nitConPrefijo;
    datos.dv = null;
    datos.nombre_comercial = campoNoAplicable(entrada.nombre_comercial, 'nombre_comercial');
    datos.contacto_telefono_fijo = campoNoAplicable(entrada.contacto_telefono_fijo, 'contacto_telefono_fijo');
    datos.tipo_sociedad = campoNoAplicable(entrada.tipo_sociedad, 'tipo_sociedad');
    datos.camara_comercio = campoNoAplicable(entrada.camara_comercio, 'camara_comercio');
    datos.fecha_exp_camara = campoNoAplicable(entrada.fecha_exp_camara, 'fecha_exp_camara');
    datos.rep_legal_nombre = campoNoAplicable(entrada.rep_legal_nombre, 'rep_legal_nombre');
    datos.rep_legal_tipo_doc = campoNoAplicable(entrada.rep_legal_tipo_doc, 'rep_legal_tipo_doc');
    datos.rep_legal_num_doc = campoNoAplicable(entrada.rep_legal_num_doc, 'rep_legal_num_doc');
    datos.rep_legal_telefono = campoNoAplicable(entrada.rep_legal_telefono, 'rep_legal_telefono');
    datos.rep_legal_email = campoNoAplicable(entrada.rep_legal_email, 'rep_legal_email');
  } else {
    if (!opciones.omitirCalculoNit) {
      const resuelto = resolverNitJuridica(entrada.nit, entrada.dv);
      datos.nit = resuelto.nit;
      datos.dv = resuelto.dv;
    }

    datos.tipo_documento = campoNoAplicable(entrada.tipo_documento, 'tipo_documento');
    datos.numero_documento = campoNoAplicable(entrada.numero_documento, 'numero_documento');

    const nombreComercial = opcional(entrada.nombre_comercial);
    if (nombreComercial != null && nombreComercial.length > 100) {
      throw new AppError('El campo nombre_comercial no puede superar 100 caracteres.', 400);
    }
    datos.nombre_comercial = nombreComercial;

    const sociedad = texto(entrada.tipo_sociedad, 'tipo_sociedad', 20);
    if (!TIPOS_SOCIEDAD.includes(sociedad)) throw new AppError('El tipo_sociedad no es válido.', 400);
    datos.tipo_sociedad = sociedad;

    const telFijo = opcional(entrada.contacto_telefono_fijo);
    datos.contacto_telefono_fijo =
      telFijo == null ? null : validarTelefono(telFijo, 'contacto_telefono_fijo', 20, 7);

    datos.camara_comercio = validarUrl(entrada.camara_comercio);
    datos.fecha_exp_camara = validarFecha(entrada.fecha_exp_camara);
    datos.rep_legal_nombre = texto(entrada.rep_legal_nombre, 'rep_legal_nombre', 100);
    const tipoRep = texto(entrada.rep_legal_tipo_doc, 'rep_legal_tipo_doc', 10);
    if (!TIPOS_DOCUMENTO.includes(tipoRep)) {
      throw new AppError('El tipo de documento del representante legal no es válido.', 400);
    }
    datos.rep_legal_tipo_doc = tipoRep;
    datos.rep_legal_num_doc = validarDigitos(entrada.rep_legal_num_doc, 'rep_legal_num_doc', 15, 5);
    datos.rep_legal_telefono = validarTelefono(entrada.rep_legal_telefono, 'rep_legal_telefono', 20, 7);
    datos.rep_legal_email = validarCorreo(entrada.rep_legal_email, 'rep_legal_email');
  }
  return datos;
}

export function validarEditarProveedor(body, actual) {
  const entrada = body || {};
  const proveedorActual = typeof actual === 'string' ? { tipo_persona: actual } : (actual || {});
  const tipoPersonaActual = proveedorActual.tipo_persona;

  if (entrada.tipo_persona !== undefined && entrada.tipo_persona !== tipoPersonaActual) {
    throw new AppError('El tipo_persona del proveedor no se puede cambiar.', 400);
  }

  if (
    entrada.nombre !== undefined &&
    String(entrada.nombre).trim() !== '' &&
    proveedorActual.nombre &&
    String(entrada.nombre).trim() !== String(proveedorActual.nombre).trim()
  ) {
    throw new AppError('El nombre o razón social del proveedor no se puede modificar después de creado.', 400);
  }

  if (tipoPersonaActual === 'Juridica') {
    const nitActualDigitos = String(proveedorActual.nit ?? '').replace(/\D/g, '');
    const nitActualConDv =
      nitActualDigitos.length === 9 && proveedorActual.dv
        ? `${nitActualDigitos}${proveedorActual.dv}`
        : nitActualDigitos;

    if (entrada.nit !== undefined && String(entrada.nit).trim() !== '') {
      const nitEnviadoDigitos = String(entrada.nit).replace(/\D/g, '');
      if (
        nitActualDigitos &&
        nitEnviadoDigitos !== nitActualDigitos &&
        nitEnviadoDigitos !== nitActualConDv &&
        nitEnviadoDigitos !== nitActualDigitos.slice(0, 9)
      ) {
        throw new AppError('El NIT del proveedor no se puede modificar después de creado.', 400);
      }
    }

    const datos = validarCrearProveedor(
      {
        ...entrada,
        tipo_persona: tipoPersonaActual,
        nombre: proveedorActual.nombre ?? entrada.nombre,
      },
      { omitirCalculoNit: true }
    );
    if (proveedorActual.nombre) datos.nombre = proveedorActual.nombre;
    datos.nit = proveedorActual.nit ?? resolverNitJuridica(entrada.nit, entrada.dv).nit;
    datos.dv =
      proveedorActual.dv ??
      (nitActualDigitos.length >= 9 ? calcularDvNit(nitActualDigitos.slice(0, 9)) : null);
    return datos;
  }

  if (
    entrada.tipo_documento !== undefined &&
    String(entrada.tipo_documento).trim() !== '' &&
    proveedorActual.tipo_documento &&
    String(entrada.tipo_documento).trim() !== proveedorActual.tipo_documento
  ) {
    throw new AppError('El tipo de documento del proveedor no se puede modificar después de creado.', 400);
  }

  if (
    entrada.numero_documento !== undefined &&
    String(entrada.numero_documento).trim() !== '' &&
    proveedorActual.numero_documento
  ) {
    const docEnviado = String(entrada.numero_documento).replace(/\D/g, '');
    const docActual = String(proveedorActual.numero_documento).replace(/\D/g, '');
    if (docActual && docEnviado !== docActual) {
      throw new AppError('El número de documento del proveedor no se puede modificar después de creado.', 400);
    }
  }

  const datos = validarCrearProveedor({
    ...entrada,
    tipo_persona: tipoPersonaActual,
    nombre: proveedorActual.nombre ?? entrada.nombre,
    tipo_documento: proveedorActual.tipo_documento ?? entrada.tipo_documento,
    numero_documento: proveedorActual.numero_documento ?? entrada.numero_documento,
  });
  if (proveedorActual.nombre) datos.nombre = proveedorActual.nombre;
  if (proveedorActual.tipo_documento) datos.tipo_documento = proveedorActual.tipo_documento;
  if (proveedorActual.numero_documento) datos.numero_documento = proveedorActual.numero_documento;
  if (proveedorActual.nit) {
    datos.nit = proveedorActual.nit;
    datos.dv = proveedorActual.dv ?? null;
  }
  return datos;
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
