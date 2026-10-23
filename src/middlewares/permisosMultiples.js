import AppError from '../errors/AppError.js';
import { query } from '../config/db.js';
import { obtenerPermisos } from '../services/auth.service.js';

async function permisosDelUsuario(idUsuario) {
  const { rows } = await query(
    'SELECT id_rol, estado FROM tb_usuarios WHERE id_usuario = $1',
    [idUsuario]
  );
  const usuario = rows[0];
  if (!usuario || !usuario.estado) throw new AppError('No autorizado.', 403);
  return obtenerPermisos(usuario.id_rol, idUsuario);
}

function coincide(permisosUsuario, permisoRequerido) {
  return permisosUsuario.some((permiso) =>
    permiso.modulo === permisoRequerido.modulo &&
    permiso.nombre === permisoRequerido.nombre &&
    permiso.privilegios.includes(permisoRequerido.privilegio)
  );
}

export function requiereAlgunPermiso(permisosRequeridos, mensaje = 'No tienes permiso para realizar esta acción.') {
  return async (req, res, next) => {
    try {
      const permisosUsuario = await permisosDelUsuario(req.usuario.id);
      if (!permisosRequeridos.some((permiso) => coincide(permisosUsuario, permiso))) {
        return next(new AppError(mensaje, 403));
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export async function validarPermisoUsuario(req, permisoRequerido, mensaje = 'No tienes permiso para realizar esta acción.') {
  const permisosUsuario = await permisosDelUsuario(req.usuario.id);
  if (!coincide(permisosUsuario, permisoRequerido)) throw new AppError(mensaje, 403);
}
