import AppError from '../errors/AppError.js';
import {
  validarFormatoCorreo,
  validarFormatoContrasena,
} from './auth.validator.js';

const CODIGO_INVALIDO = 'El código es incorrecto o venció.';
const REGEX_CODIGO = /^\d{6}$/;

function validarCodigo(codigo) {
  if (typeof codigo !== 'string' || !REGEX_CODIGO.test(codigo)) {
    throw new AppError(CODIGO_INVALIDO, 400);
  }
  return codigo;
}

export function validarSolicitudRecuperacion(req, res, next) {
  const { correo } = req.body || {};

  req.body = { correo: validarFormatoCorreo(correo) };

  next();
}

export function validarVerificacionCodigo(req, res, next) {
  const { correo, codigo } = req.body || {};

  const correoLimpio = validarFormatoCorreo(correo);
  const codigoLimpio = validarCodigo(codigo);

  req.body = { correo: correoLimpio, codigo: codigoLimpio };

  next();
}

export function validarRestablecimiento(req, res, next) {
  const { correo, codigo, contrasena } = req.body || {};

  validarFormatoContrasena(contrasena);
  const correoLimpio = validarFormatoCorreo(correo);
  const codigoLimpio = validarCodigo(codigo);

  req.body = {
    correo: correoLimpio,
    codigo: codigoLimpio,
    contrasena,
  };

  next();
}
