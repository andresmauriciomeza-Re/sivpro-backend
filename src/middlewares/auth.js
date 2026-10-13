import jwt from 'jsonwebtoken';
import AppError from '../errors/AppError.js';

export function verificarToken(req, res, next) {
  const authorization = req.headers.authorization || '';
  const [esquema, token] = authorization.split(' ');

  if (esquema !== 'Bearer' || !token) {
    return next(new AppError('Token no proporcionado.', 401));
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ['HS256'],
    });
    req.usuario = { id: payload.sub, rol: payload.rol };
    next();
  } catch (error) {
    next(new AppError('Token inválido o expirado.', 401));
  }
}
