import AppError from '../errors/AppError.js';
import { validarFormatoContrasena } from './auth.validator.js';

// Activación de cuenta de empleado (público): el token es un hex de 32 bytes
// (crypto.randomBytes(32)). Un token mal formado responde igual que uno vencido
// o ya usado, para no dar pistas sobre qué enlaces existen.
const REGEX_TOKEN = /^[a-f0-9]{64}$/i;
const ENLACE_INVALIDO =
  'El enlace venció o ya fue usado. Pide a la administración que te reenvíe la invitación.';

export function validarTokenActivacionParam(req, res, next) {
  const token = String(req.params?.token ?? '').trim();
  if (!REGEX_TOKEN.test(token)) throw new AppError(ENLACE_INVALIDO, 400);
  req.params.token = token.toLowerCase();
  next();
}

export function validarActivacion(req, res, next) {
  const body = req.body || {};
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!REGEX_TOKEN.test(token)) throw new AppError(ENLACE_INVALIDO, 400);
  // Misma regla que el resto del sistema: 8+, mayúscula, minúscula, número y
  // sin espacios. El mensaje vive en auth.validator.
  validarFormatoContrasena(body.contrasena);
  req.body = { token: token.toLowerCase(), contrasena: body.contrasena };
  next();
}
