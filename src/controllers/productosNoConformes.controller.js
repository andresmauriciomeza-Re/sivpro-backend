import {
  actualizarProductoNoConforme,
  completarProductoNoConforme,
  crearProductoNoConforme,
  eliminarProductoNoConforme,
  listarProductosNoConformes,
  obtenerProductoNoConforme,
} from '../services/productosNoConformes.service.js';
import {
  validarCompletarProductoNoConforme,
  validarCrearProductoNoConforme,
  validarEditarProductoNoConforme,
  validarFiltrosProductosNoConformes,
  validarIdProductoNoConforme,
} from '../validators/productosNoConformes.validator.js';

export async function listarProductosNoConformesController(req, res, next) {
  try {
    res.json(await listarProductosNoConformes(validarFiltrosProductosNoConformes(req.query)));
  } catch (error) {
    next(error);
  }
}

export async function obtenerProductoNoConformeController(req, res, next) {
  try {
    res.json(await obtenerProductoNoConforme(validarIdProductoNoConforme(req.params.id)));
  } catch (error) {
    next(error);
  }
}

export async function crearProductoNoConformeController(req, res, next) {
  try {
    res.status(201).json(await crearProductoNoConforme(validarCrearProductoNoConforme(req.body)));
  } catch (error) {
    next(error);
  }
}

export async function actualizarProductoNoConformeController(req, res, next) {
  try {
    res.json(await actualizarProductoNoConforme(
      validarIdProductoNoConforme(req.params.id),
      validarEditarProductoNoConforme(req.body)
    ));
  } catch (error) {
    next(error);
  }
}

export async function completarProductoNoConformeController(req, res, next) {
  try {
    res.json(await completarProductoNoConforme(
      validarIdProductoNoConforme(req.params.id),
      validarCompletarProductoNoConforme(req.body)
    ));
  } catch (error) {
    next(error);
  }
}

export async function eliminarProductoNoConformeController(req, res, next) {
  try {
    res.json(await eliminarProductoNoConforme(validarIdProductoNoConforme(req.params.id)));
  } catch (error) {
    next(error);
  }
}
