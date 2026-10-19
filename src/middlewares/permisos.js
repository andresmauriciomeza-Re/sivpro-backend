import AppError from '../errors/AppError.js';
import { query } from '../config/db.js';
import { obtenerPermisos } from '../services/auth.service.js';

// Exige que el usuario del token tenga un privilegio concreto de un permiso,
// con la MISMA lógica que usa el login (rol base + roles extra del empleado
// vigente). El estado también se verifica aquí: un token emitido antes de
// desactivar la cuenta ya no debe poder usar rutas sensibles.
export function requierePermiso({ modulo, nombre, privilegio, mensaje }) {
  return async (req, res, next) => {
    try {
      const { rows } = await query(
        'SELECT id_rol, estado FROM tb_usuarios WHERE id_usuario = $1',
        [req.usuario.id]
      );
      const usuario = rows[0];
      if (!usuario || !usuario.estado) {
        return next(new AppError('No autorizado.', 403));
      }
      const permisos = await obtenerPermisos(usuario.id_rol, req.usuario.id);
      const permitido = permisos.some(
        (p) =>
          p.modulo === modulo &&
          p.nombre === nombre &&
          p.privilegios.includes(privilegio)
      );
      if (!permitido) {
        return next(new AppError(mensaje, 403));
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
