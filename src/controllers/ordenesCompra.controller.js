import {
  actualizarOrdenCompra,
  cambiarEstadoOrdenCompra,
  crearOrdenCompra,
  listarOrdenesCompra,
  obtenerOrdenCompra,
  recibirOrdenCompra,
} from '../services/ordenesCompra.service.js';
import {
  validarCrearOrdenCompra,
  validarEditarOrdenCompra,
  validarEstadoOrdenCompra,
  validarFiltrosOrdenCompra,
  validarIdOrdenCompra,
} from '../validators/ordenesCompra.validator.js';
import { validarRecepcionCompra } from '../validators/compras.validator.js';

export async function listarOrdenesCompraController(req, res, next) {
  try {
    res.json(await listarOrdenesCompra(validarFiltrosOrdenCompra(req.query)));
  } catch (error) {
    next(error);
  }
}

export async function obtenerOrdenCompraController(req, res, next) {
  try {
    res.json(await obtenerOrdenCompra(validarIdOrdenCompra(req.params.id)));
  } catch (error) {
    next(error);
  }
}

export async function crearOrdenCompraController(req, res, next) {
  try {
    res.status(201).json(await crearOrdenCompra(validarCrearOrdenCompra(req.body)));
  } catch (error) {
    next(error);
  }
}

export async function actualizarOrdenCompraController(req, res, next) {
  try {
    res.json(await actualizarOrdenCompra(validarIdOrdenCompra(req.params.id), validarEditarOrdenCompra(req.body)));
  } catch (error) {
    next(error);
  }
}

export async function cambiarEstadoOrdenCompraController(req, res, next) {
  try {
    res.json(await cambiarEstadoOrdenCompra(validarIdOrdenCompra(req.params.id), validarEstadoOrdenCompra(req.body)));
  } catch (error) {
    next(error);
  }
}

export async function recibirOrdenCompraController(req, res, next) {
  try {
    res.status(201).json(await recibirOrdenCompra(validarIdOrdenCompra(req.params.id), validarRecepcionCompra(req.body)));
  } catch (error) {
    next(error);
  }
}
