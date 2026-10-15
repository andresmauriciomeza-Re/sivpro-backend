import {
  procesarSolicitudRecuperacion,
  verificarCodigoRecuperacion,
  restablecerContrasena,
} from '../services/recuperacion.service.js';

const MENSAJE_SOLICITUD = 'Si el correo está registrado, te enviamos un código.';

export function solicitarCodigo(req, res, next) {
  try {
    res.status(200).json({ mensaje: MENSAJE_SOLICITUD });

    procesarSolicitudRecuperacion(req.body.correo).catch((error) => {
      console.error('Error en segundo plano de recuperación:', error.code);
    });
  } catch (error) {
    next(error);
  }
}

export async function verificarCodigo(req, res, next) {
  try {
    const resultado = await verificarCodigoRecuperacion(
      req.body.correo,
      req.body.codigo
    );
    res.status(200).json(resultado);
  } catch (error) {
    next(error);
  }
}

export async function restablecer(req, res, next) {
  try {
    const resultado = await restablecerContrasena(
      req.body.correo,
      req.body.codigo,
      req.body.contrasena
    );
    res.status(200).json(resultado);
  } catch (error) {
    next(error);
  }
}
