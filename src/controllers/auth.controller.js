import {
  actualizarPerfilUsuario,
  login,
  obtenerUsuarioPorId,
  registrarCliente,
} from '../services/auth.service.js';
import { enviarCorreoBienvenida } from '../services/mail.service.js';
import {
  registrarFallo,
  reiniciarIntentos,
  registrarIntentoPerfil,
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

export async function actualizarPerfil(req, res, next) {
  // Cuenta el intento ANTES de validar el resultado: el rate limit del
  // perfil frena el abuso, no solo los fallos.
  registrarIntentoPerfil(req.claveIntentoPerfil);
  try {
    const usuario = await actualizarPerfilUsuario(
      req.usuario.id,
      req.body.correo,
      req.body.telefono
    );
    res.status(200).json(usuario);
  } catch (error) {
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
