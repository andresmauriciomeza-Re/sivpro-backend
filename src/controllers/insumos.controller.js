import {
  actualizarInsumo,
  cambiarEstadoInsumo,
  crearInsumo,
  eliminarInsumo,
  listarCategoriasInsumo,
  listarInsumos,
  obtenerInsumo,
} from '../services/insumos.service.js';
import {
  validarCrearInsumo,
  validarEditarInsumo,
  validarEstadoInsumo,
  validarFiltrosInsumos,
  validarIdInsumo,
} from '../validators/insumos.validator.js';

export async function listarCategoriasInsumoController(req, res, next) {
  try {
    res.json(await listarCategoriasInsumo());
  } catch (error) {
    next(error);
  }
}

export async function listarInsumosController(req, res, next) {
  try {
    res.json(await listarInsumos(validarFiltrosInsumos(req.query)));
  } catch (error) {
    next(error);
  }
}

export async function obtenerInsumoController(req, res, next) {
  try {
    res.json(await obtenerInsumo(validarIdInsumo(req.params.id)));
  } catch (error) {
    next(error);
  }
}

export async function crearInsumoController(req, res, next) {
  try {
    res.status(201).json(await crearInsumo(validarCrearInsumo(req.body)));
  } catch (error) {
    if (error.faltantes) {
      return res.status(error.statusCode).json({
        error: { message: error.message, statusCode: error.statusCode, faltantes: error.faltantes },
      });
    }
    next(error);
  }
}

export async function actualizarInsumoController(req, res, next) {
  try {
    res.json(await actualizarInsumo(validarIdInsumo(req.params.id), validarEditarInsumo(req.body)));
  } catch (error) {
    next(error);
  }
}

export async function cambiarEstadoInsumoController(req, res, next) {
  try {
    res.json(await cambiarEstadoInsumo(validarIdInsumo(req.params.id), validarEstadoInsumo(req.body)));
  } catch (error) {
    next(error);
  }
}

export async function eliminarInsumoController(req, res, next) {
  try {
    res.json(await eliminarInsumo(validarIdInsumo(req.params.id)));
  } catch (error) {
    next(error);
  }
}
