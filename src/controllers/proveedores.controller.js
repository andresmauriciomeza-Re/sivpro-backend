import AppError from '../errors/AppError.js';
import {
  actualizarProveedor,
  cambiarEstadoProveedor,
  crearProveedor,
  eliminarProveedor,
  listarProveedores,
  obtenerProveedor,
} from '../services/proveedores.service.js';
import {
  validarCrearProveedor,
  validarEditarProveedor,
  validarEstadoProveedor,
  validarFiltroEstado,
  validarIdProveedor,
} from '../validators/proveedores.validator.js';

export async function listarProveedoresController(req, res, next) {
  try {
    res.json(await listarProveedores(validarFiltroEstado(req.query)));
  } catch (error) {
    next(error);
  }
}

export async function obtenerProveedorController(req, res, next) {
  try {
    res.json(await obtenerProveedor(validarIdProveedor(req.params.id)));
  } catch (error) {
    next(error);
  }
}

export async function crearProveedorController(req, res, next) {
  try {
    res.status(201).json(await crearProveedor(validarCrearProveedor(req.body)));
  } catch (error) {
    next(error);
  }
}

export async function actualizarProveedorController(req, res, next) {
  try {
    const id = validarIdProveedor(req.params.id);
    const actual = await obtenerProveedor(id);
    const datos = validarEditarProveedor(req.body, actual);
    res.json(await actualizarProveedor(id, datos));
  } catch (error) {
    next(error);
  }
}

export async function cambiarEstadoProveedorController(req, res, next) {
  try {
    res.json(await cambiarEstadoProveedor(validarIdProveedor(req.params.id), validarEstadoProveedor(req.body)));
  } catch (error) {
    next(error);
  }
}

export async function eliminarProveedorController(req, res, next) {
  try {
    res.json(await eliminarProveedor(validarIdProveedor(req.params.id)));
  } catch (error) {
    if (error instanceof AppError) return next(error);
    next(error);
  }
}
