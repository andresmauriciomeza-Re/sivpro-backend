import {
  actualizarOrdenProduccion,
  completarOrdenProduccion,
  crearOrdenProduccion,
  darBajaOrdenProduccion,
  eliminarOrdenProduccion,
  iniciarOrdenProduccion,
  listarOrdenesProduccion,
  obtenerOrdenProduccion,
  obtenerRequeridosOrdenProduccion,
} from '../services/ordenesProduccion.service.js';
import {
  validarCompletarOrdenProduccion,
  validarCrearOrdenProduccion,
  validarDarBajaOrdenProduccion,
  validarEditarOrdenProduccion,
  validarFiltrosOrdenesProduccion,
  validarIdOrdenProduccion,
} from '../validators/ordenesProduccion.validator.js';
import responderConFaltantes from '../utils/responderConFaltantes.js';

export async function listarOrdenesProduccionController(req, res, next) {
  try {
    res.json(await listarOrdenesProduccion(validarFiltrosOrdenesProduccion(req.query)));
  } catch (error) {
    next(error);
  }
}

export async function obtenerOrdenProduccionController(req, res, next) {
  try {
    res.json(await obtenerOrdenProduccion(validarIdOrdenProduccion(req.params.id)));
  } catch (error) {
    next(error);
  }
}

export async function obtenerRequeridosOrdenProduccionController(req, res, next) {
  try {
    res.json(await obtenerRequeridosOrdenProduccion(validarIdOrdenProduccion(req.params.id)));
  } catch (error) {
    next(error);
  }
}

export async function crearOrdenProduccionController(req, res, next) {
  try {
    res.status(201).json(await crearOrdenProduccion(validarCrearOrdenProduccion(req.body)));
  } catch (error) {
    responderConFaltantes(error, res, next);
  }
}

export async function actualizarOrdenProduccionController(req, res, next) {
  try {
    res.json(await actualizarOrdenProduccion(
      validarIdOrdenProduccion(req.params.id),
      validarEditarOrdenProduccion(req.body)
    ));
  } catch (error) {
    responderConFaltantes(error, res, next);
  }
}

export async function eliminarOrdenProduccionController(req, res, next) {
  try {
    res.json(await eliminarOrdenProduccion(validarIdOrdenProduccion(req.params.id)));
  } catch (error) {
    next(error);
  }
}

export async function iniciarOrdenProduccionController(req, res, next) {
  try {
    res.json(await iniciarOrdenProduccion(validarIdOrdenProduccion(req.params.id)));
  } catch (error) {
    responderConFaltantes(error, res, next);
  }
}

export async function completarOrdenProduccionController(req, res, next) {
  try {
    res.json(await completarOrdenProduccion(
      validarIdOrdenProduccion(req.params.id),
      validarCompletarOrdenProduccion(req.body)
    ));
  } catch (error) {
    responderConFaltantes(error, res, next);
  }
}

export async function darBajaOrdenProduccionController(req, res, next) {
  try {
    res.json(await darBajaOrdenProduccion(
      validarIdOrdenProduccion(req.params.id),
      validarDarBajaOrdenProduccion(req.body)
    ));
  } catch (error) {
    next(error);
  }
}
