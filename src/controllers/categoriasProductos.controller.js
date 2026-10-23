import {
  cambiarEstadoCategoria,
  crearCategoria,
  editarCategoria,
  eliminarCategoria,
  listarCategoriasGestion,
} from '../services/categoriasProductos.service.js';
import {
  validarCrearCategoria,
  validarEditarCategoria,
  validarEstadoCategoria,
  validarIdCategoria,
} from '../validators/categoriasProductos.validator.js';

export async function listarCategoriasGestionController(req, res, next) {
  try {
    res.json(await listarCategoriasGestion());
  } catch (error) {
    next(error);
  }
}

export async function crearCategoriaController(req, res, next) {
  try {
    res.status(201).json(await crearCategoria(validarCrearCategoria(req.body)));
  } catch (error) {
    next(error);
  }
}

export async function editarCategoriaController(req, res, next) {
  try {
    res.json(await editarCategoria(
      validarIdCategoria(req.params.id),
      validarEditarCategoria(req.body)
    ));
  } catch (error) {
    next(error);
  }
}

export async function cambiarEstadoCategoriaController(req, res, next) {
  try {
    res.json(await cambiarEstadoCategoria(
      validarIdCategoria(req.params.id),
      validarEstadoCategoria(req.body)
    ));
  } catch (error) {
    next(error);
  }
}

export async function eliminarCategoriaController(req, res, next) {
  try {
    res.json(await eliminarCategoria(validarIdCategoria(req.params.id)));
  } catch (error) {
    next(error);
  }
}
