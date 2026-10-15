import {
  login,
  obtenerUsuarioPorId,
  registrarCliente,
} from '../services/auth.service.js';
import { registrarFallo, reiniciarIntentos } from '../utils/loginLimiter.js';
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

export async function registrar(req, res, next) {
  try {
    const resultado = await registrarCliente(req.body);
    registrarIntento(req.claveRegistro);
    res.status(201).json(resultado);
  } catch (error) {
    if (error.statusCode === 409) {
      registrarIntento(req.claveRegistro);
    }
    next(error);
  }
}
