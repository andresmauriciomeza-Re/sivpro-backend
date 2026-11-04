import {
  actualizarParametrosCostos,
  obtenerParametrosCostos,
} from '../services/parametrosCostos.service.js';
import { validarActualizarParametrosCostos } from '../validators/parametrosCostos.validator.js';

export async function obtenerParametrosCostosController(req, res, next) {
  try {
    res.json(await obtenerParametrosCostos());
  } catch (error) {
    next(error);
  }
}

export async function actualizarParametrosCostosController(req, res, next) {
  try {
    const datos = validarActualizarParametrosCostos(req.body);
    res.json(await actualizarParametrosCostos(datos));
  } catch (error) {
    next(error);
  }
}
