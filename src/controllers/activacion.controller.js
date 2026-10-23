import {
  activarCuenta,
  obtenerDatosActivacion,
} from '../services/activacion.service.js';

export async function consultarActivacion(req, res, next) {
  try {
    res.status(200).json(await obtenerDatosActivacion(req.params.token));
  } catch (error) { next(error); }
}

export async function activarCuentaControlador(req, res, next) {
  try {
    res.status(200).json(await activarCuenta(req.body.token, req.body.contrasena));
  } catch (error) { next(error); }
}
