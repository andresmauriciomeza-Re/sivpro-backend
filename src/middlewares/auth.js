import jwt from 'jsonwebtoken';
import AppError from '../errors/AppError.js';
import { query } from '../config/db.js';

export async function verificarToken(req, res, next) {
  const authorization = req.headers.authorization || '';
  const [esquema, token] = authorization.split(' ');

  if (esquema !== 'Bearer' || !token) {
    return next(new AppError('Token no proporcionado.', 401));
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ['HS256'],
    });
  } catch (error) {
    if (error?.name === 'TokenExpiredError') {
      return next(new AppError('Tu sesión ha expirado. Inicia sesión nuevamente.', 401, 'TOKEN_EXPIRADO'));
    }
    return next(new AppError('Token inválido.', 401, 'TOKEN_INVALIDO'));
  }

  try {
    const { rows } = await query(
      `SELECT u.id_usuario, u.estado, u.token_version,
              r.nombre AS rol, r.estado AS rol_estado
         FROM tb_usuarios u
         JOIN tb_roles r ON r.id_rol = u.id_rol
        WHERE u.id_usuario = $1`,
      [payload.sub]
    );
    const usuario = rows[0];
    if (
      !usuario ||
      !usuario.estado ||
      !usuario.rol_estado ||
      Number(payload.tv ?? 0) !== Number(usuario.token_version ?? 0)
    ) {
      return next(new AppError('La sesión ya no es válida. Inicia sesión nuevamente.', 401, 'SESION_INVALIDADA'));
    }

    req.usuario = { id: usuario.id_usuario, rol: usuario.rol };
    return next();
  } catch (error) {
    return next(error);
  }
}
