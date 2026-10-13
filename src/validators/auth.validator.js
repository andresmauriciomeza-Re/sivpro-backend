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
