import AppError from '../errors/AppError.js';

const MAX_LENGTH = 255;

export function validarLogin(req, res, next) {
  const { correo, contrasena } = req.body || {};

  if (
    typeof correo !== 'string' ||
    correo.trim().length === 0 ||
    correo.length > MAX_LENGTH
  ) {
    throw new AppError(
      'El correo es obligatorio, debe ser texto y no puede superar 255 caracteres.',
      400
    );
  }

  if (
    typeof contrasena !== 'string' ||
    contrasena.length === 0 ||
    contrasena.length > MAX_LENGTH
  ) {
    throw new AppError(
      'La contraseña es obligatoria, debe ser texto y no puede superar 255 caracteres.',
      400
    );
  }

  next();
}

const TIPOS_DOCUMENTO = ['CC', 'CE', 'PP'];

const TIPO_GUARDADO = {
  CC: 'CC',
  CE: 'CE',
  PP: 'Pasaporte',
};

const LONGITUD_NUMERO = {
  CC: { min: 6, max: 10 },
  CE: { min: 6, max: 12 },
  Pasaporte: { min: 6, max: 12 },
};

const LETRA = '[A-Za-z\\u00C1-\\u00D6\\u00D8-\\u00DC\\u00E1-\\u00F6\\u00F8-\\u00FC]';
const REGEX_NOMBRE = new RegExp(`^${LETRA}+(?: ${LETRA}+)*$`);
const REGEX_CORREO =
  /^[A-Za-z0-9._-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
// Regla única de teléfono (misma que el frontend): solo números, entre 7 y
// 15 dígitos. Ya no se exige empezar por 3 (acepta fijo o celular).
const REGEX_TELEFONO = /^\d{7,15}$/;
const REGEX_PASSWORD_SEGURA = /(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/;

const MAX_CORREO = 60;
const MAX_NOMBRE = 100;
const MIN_NOMBRE = 2;
const MIN_CONTRASENA = 8;
const MAX_CONTRASENA_CARACTERES = 72;
const MAX_CONTRASENA_BYTES = 72;

function esTexto(valor) {
  return typeof valor === 'string' && valor.trim().length > 0;
}

const MENSAJES = {
  tipoDocumento: 'Tipo de documento no válido.',
  numeroDocumento: 'El número de documento no es válido.',
  nombre: 'El nombre no es válido.',
  correo: 'Ingresa un correo válido y sin espacios.',
  telefono: 'El teléfono debe tener solo números, entre 7 y 15 dígitos.',
  contrasena: 'La contraseña no cumple los requisitos.',
};

export function validarFormatoCorreo(correo) {
  if (!esTexto(correo)) {
    throw new AppError(MENSAJES.correo, 400);
  }

  const correoLimpio = correo.trim().toLowerCase();
  if (correoLimpio.length > MAX_CORREO || !REGEX_CORREO.test(correoLimpio)) {
    throw new AppError(MENSAJES.correo, 400);
  }

  return correoLimpio;
}

export function validarFormatoContrasena(contrasena) {
  if (typeof contrasena !== 'string' || contrasena.length === 0) {
    throw new AppError(MENSAJES.contrasena, 400);
  }

  if (
    contrasena.length < MIN_CONTRASENA ||
    contrasena.length > MAX_CONTRASENA_CARACTERES ||
    Buffer.byteLength(contrasena, 'utf8') > MAX_CONTRASENA_BYTES ||
    /\s/.test(contrasena) ||
    !REGEX_PASSWORD_SEGURA.test(contrasena)
  ) {
    throw new AppError(MENSAJES.contrasena, 400);
  }
}

/**
 * PUT /auth/perfil: acepta SOLO correo y teléfono; cualquier otro campo del
 * body (nombre, documento, rol, estado, id…) se descarta al reescribir
 * req.body. El teléfono usa la MISMA regla única que el registro (solo
 * números, entre 7 y 15 dígitos), centralizada en MENSAJES/REGEX_TELEFONO.
 */
export function validarActualizacionPerfil(req, res, next) {
  const body = req.body || {};

  const correo = validarFormatoCorreo(body.correo);

  if (typeof body.telefono !== 'string') {
    throw new AppError('El teléfono es obligatorio.', 400);
  }
  const telefono = body.telefono.replace(/\s+/g, '');
  if (!REGEX_TELEFONO.test(telefono)) {
    throw new AppError(MENSAJES.telefono, 400);
  }

  req.body = { correo, telefono };
  next();
}

export function validarRegistro(req, res, next) {
  const body = req.body || {};

  const { tipoDocumento, numeroDocumento, nombre, correo, telefono, contrasena } =
    body;

  if (!esTexto(tipoDocumento)) {
    throw new AppError(MENSAJES.tipoDocumento, 400);
  }

  const tipoOriginal = tipoDocumento.trim();
  if (!TIPOS_DOCUMENTO.includes(tipoOriginal)) {
    throw new AppError(MENSAJES.tipoDocumento, 400);
  }
  const tipo = TIPO_GUARDADO[tipoOriginal];

  if (!esTexto(numeroDocumento)) {
    throw new AppError(MENSAJES.numeroDocumento, 400);
  }

  const numero = numeroDocumento.trim();
  const limites = LONGITUD_NUMERO[tipo];
  if (!/^\d+$/.test(numero)) {
    throw new AppError(MENSAJES.numeroDocumento, 400);
  }
  if (numero.length < limites.min || numero.length > limites.max) {
    throw new AppError(MENSAJES.numeroDocumento, 400);
  }

  if (!esTexto(nombre)) {
    throw new AppError(MENSAJES.nombre, 400);
  }

  const nombreLimpio = nombre.trim();
  if (
    nombreLimpio.length < MIN_NOMBRE ||
    nombreLimpio.length > MAX_NOMBRE ||
    !REGEX_NOMBRE.test(nombreLimpio)
  ) {
    throw new AppError(MENSAJES.nombre, 400);
  }

  const correoLimpio = validarFormatoCorreo(correo);

  if (!esTexto(telefono)) {
    throw new AppError(MENSAJES.telefono, 400);
  }

  const telefonoLimpio = telefono.replace(/\s+/g, '');
  if (!REGEX_TELEFONO.test(telefonoLimpio)) {
    throw new AppError(MENSAJES.telefono, 400);
  }

  validarFormatoContrasena(contrasena);

  req.body = {
    tipoDocumento: tipo,
    numeroDocumento: numero,
    nombre: nombreLimpio,
    correo: correoLimpio,
    telefono: telefonoLimpio,
    contrasena,
  };

  next();
}

/**
 * Datos básicos de una persona (alta de cliente o empleado): tipo y número de
 * documento, nombre, correo y teléfono. `telefonoOpcional` acepta el formato
 * del formulario de empleado, donde el teléfono puede ir vacío; con valor
 * aplica la MISMA regla única (solo números, entre 7 y 15 dígitos).
 */
export function validarDatosPersona(body, { telefonoOpcional = false } = {}) {
  const datos = body || {};
  const tipo = TIPO_GUARDADO[datos.tipoDocumento];
  if (!tipo) throw new AppError(MENSAJES.tipoDocumento, 400);
  const numero = typeof datos.numeroDocumento === 'string' ? datos.numeroDocumento.trim() : '';
  const limites = LONGITUD_NUMERO[tipo];
  if (!/^\d+$/.test(numero) || numero.length < limites.min || numero.length > limites.max) {
    throw new AppError(MENSAJES.numeroDocumento, 400);
  }
  const nombre = typeof datos.nombre === 'string' ? datos.nombre.trim() : '';
  if (nombre.length < MIN_NOMBRE || nombre.length > MAX_NOMBRE || !REGEX_NOMBRE.test(nombre)) {
    throw new AppError(MENSAJES.nombre, 400);
  }
  const correo = validarFormatoCorreo(datos.correo);
  const telefono = typeof datos.telefono === 'string' ? datos.telefono.replace(/\s+/g, '') : '';
  if (!telefono && telefonoOpcional) {
    return { tipoDocumento: tipo, numeroDocumento: numero, nombre, correo, telefono: '' };
  }
  if (!REGEX_TELEFONO.test(telefono)) throw new AppError(MENSAJES.telefono, 400);
  return { tipoDocumento: tipo, numeroDocumento: numero, nombre, correo, telefono };
}

// Alta administrativa: mismas reglas públicas del registro, sin aceptar una
// contraseña del cliente (el servicio genera una aleatoria).
export function validarAltaCliente(req, res, next) {
  req.body = validarDatosPersona(req.body);
  next();
}

export function validarEdicionCliente(req, res, next) {
  const body = req.body || {};
  const nombre = typeof body.nombre === 'string' ? body.nombre.trim() : '';
  if (nombre.length < MIN_NOMBRE || nombre.length > MAX_NOMBRE || !REGEX_NOMBRE.test(nombre)) {
    throw new AppError(MENSAJES.nombre, 400);
  }
  const correo = validarFormatoCorreo(body.correo);
  const telefono = typeof body.telefono === 'string' ? body.telefono.replace(/\s+/g, '') : '';
  if (!REGEX_TELEFONO.test(telefono)) throw new AppError(MENSAJES.telefono, 400);
  req.body = { nombre, correo, telefono };
  next();
}
