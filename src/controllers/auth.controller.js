import {
  actualizarPerfilUsuario,
  login,
  obtenerUsuarioPorId,
  registrarCliente,
} from '../services/auth.service.js';
import {
  enviarCorreoBienvenida,
  enviarCorreoVerificacion,
} from '../services/mail.service.js';
import {
  reenviarVerificacion,
  verificarCorreo,
} from '../services/verificacion.service.js';
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
    const { usuario, verificacion } = await registrarCliente(req.body);
    registrarIntento(req.claveRegistro);

    // "Confirma tu correo": la cuenta queda pendiente hasta abrir el enlace.
    // Nunca lanza; si el SMTP falla, la cuenta ya está creada (201) y el
    // cliente puede pedir "Reenviar correo de confirmación" desde el login.
    // La bienvenida se envía al verificar el correo.
    const correoEnviado = await enviarCorreoVerificacion({
      nombre: usuario.nombre,
      correo: usuario.correo,
      token: verificacion.token,
      vencimiento: verificacion.vencimiento,
    });

    res.status(201).json({ usuario, pendienteVerificacion: true, correoEnviado });
  } catch (error) {
    if (error.statusCode === 409) {
      registrarIntento(req.claveRegistro);
    }
    next(error);
  }
}

export async function verificarCorreoControlador(req, res, next) {
  try {
    const { mensaje, correo, usuario } = await verificarCorreo(req.body.token);
    // Bienvenida de siempre, ya con el correo confirmado (fire-and-forget:
    // captura su propio error y nunca lanza).
    void enviarCorreoBienvenida(usuario);
    res.status(200).json({ mensaje, correo });
  } catch (error) {
    next(error);
  }
}

export async function reenviarVerificacionControlador(req, res, next) {
  try {
    res.status(200).json(await reenviarVerificacion(req.body.correo));
  } catch (error) {
    next(error);
  }
}
