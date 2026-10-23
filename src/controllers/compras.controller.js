import {
  anularCompra,
  crearCompra,
  listarCompras,
  obtenerCompra,
} from '../services/compras.service.js';
import {
  validarAnularCompra,
  validarCrearCompra,
  validarFiltrosCompras,
  validarIdCompra,
} from '../validators/compras.validator.js';

export async function listarComprasController(req, res, next) {
  try {
    res.json(await listarCompras(validarFiltrosCompras(req.query)));
  } catch (error) {
    next(error);
  }
}

export async function obtenerCompraController(req, res, next) {
  try {
    res.json(await obtenerCompra(validarIdCompra(req.params.id)));
  } catch (error) {
    next(error);
  }
}

export async function crearCompraController(req, res, next) {
  try {
    res.status(201).json(await crearCompra(validarCrearCompra(req.body)));
  } catch (error) {
    next(error);
  }
}

export async function anularCompraController(req, res, next) {
  try {
    const { motivo } = validarAnularCompra(req.body);
    res.json(await anularCompra(validarIdCompra(req.params.id), motivo));
  } catch (error) {
    next(error);
  }
}
