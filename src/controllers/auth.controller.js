import {
  cambiarContrasenaUsuario,
  login,
  obtenerUsuarioPorId,
  registrarCliente,
} from '../services/auth.service.js';
import {
  enviarAvisoCambioContrasena,
  enviarCorreoBienvenida,
} from '../services/mail.service.js';
import {
  registrarFallo,
  reiniciarIntentos,
  registrarFalloCambioContrasena,
  reiniciarCambioContrasena,
} from '../utils/loginLimiter.js';
import { registrarIntento } from '../utils/registerLimiter.js';

export async function iniciarSesion(req, res, next) {
  try {
    const resultado = await login(req.body.correo, req.body.contrasena);
    reiniciarIntentos(req.claveIntento);
    res.status(200).json(resultado);
  } catch (error) {
    if (error.statusCode === 401) {
      registrarFallo(req.claveIntento);
    }
    next(error);
  }
}

export async function obtenerPerfil(req, res, next) {
  try {
    const usuario = await obtenerUsuarioPorId(req.usuario.id);
    res.status(200).json(usuario);
  } catch (error) {
    next(error);
  }
}

export async function cambiarContrasena(req, res, next) {
  try {
    const { contrasenaActual, contrasenaNueva } = req.body;
    const usuario = await cambiarContrasenaUsuario(
      req.usuario.id,
      contrasenaActual,
      contrasenaNueva
    );
    reiniciarCambioContrasena(req.claveIntentoCambio);

    // Aviso de seguridad: se dispara DESPUÉS de guardar con éxito y sin
    // esperarlo (fire-and-forget). Si el SMTP falla, el cambio ya está hecho
    // y la respuesta sigue siendo 200; el error queda en la consola.
    enviarAvisoCambioContrasena({
      correo: usuario.correo,
      nombre: usuario.nombre,
    }).catch((error) => {
      console.error(
        `No se pudo enviar el aviso de cambio de contraseña a ${usuario.correo}: ${error?.code || error?.message || error}`
      );
    });

    res.status(200).json({
      ok: true,
      mensaje: 'Contraseña actualizada correctamente.',
    });
  } catch (error) {
    // Solo la contraseña ACTUAL incorrecta cuenta como intento fallido de
    // adivinanza; los demás 400 (nueva débil, igual a la actual) no suman.
    if (error.message === 'La contraseña actual es incorrecta.') {
      registrarFalloCambioContrasena(req.claveIntentoCambio);
    }
    next(error);
  }
}

export async function registrar(req, res, next) {
  try {
    const resultado = await registrarCliente(req.body);
    registrarIntento(req.claveRegistro);

    // Correo de bienvenida: se dispara DESPUÉS de guardar con éxito y sin
    // esperarlo (fire-and-forget). Si el SMTP falla, el registro ya está hecho
    // y la respuesta sigue siendo 201; el error (correo destino + motivo) queda
    // en la consola. Si el registro falla, nunca llegamos aquí.
    const { tipoDocumento, numeroDocumento, nombre, correo, telefono } = req.body;
    enviarCorreoBienvenida({
      nombre,
      correo,
      telefono,
      tipoDocumento,
      numeroDocumento,
    }).catch((error) => {
      console.error(
        `No se pudo enviar el bienvenida a ${correo}: ${error?.code || error?.message || error}`
      );
    });

    res.status(201).json(resultado);
  } catch (error) {
    if (error.statusCode === 409) {
      registrarIntento(req.claveRegistro);
    }
    next(error);
  }
}
