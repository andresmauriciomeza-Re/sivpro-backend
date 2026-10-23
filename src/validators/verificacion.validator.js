import AppError from '../errors/AppError.js';
import { validarFormatoCorreo } from './auth.validator.js';

// Verificación de correo del registro público: el token es un hex de 32 bytes
// (crypto.randomBytes(32)). Un token mal formado responde igual que uno vencido
// o ya usado, para no dar pistas sobre qué enlaces existen.
const REGEX_TOKEN = /^[a-f0-9]{64}$/i;
export const ENLACE_VERIFICACION_INVALIDO =
  'El enlace venció o ya fue usado. Inicia sesión para pedir uno nuevo.';

export function validarVerificacion(req, res, next) {
  const body = req.body || {};
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!REGEX_TOKEN.test(token)) throw new AppError(ENLACE_VERIFICACION_INVALIDO, 400);
  req.body = { token: token.toLowerCase() };
  next();
}

export function validarReenvioVerificacion(req, res, next) {
  req.body = { correo: validarFormatoCorreo((req.body || {}).correo) };
  next();
}
