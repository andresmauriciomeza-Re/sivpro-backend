import {
  cambiarEstadoRol,
  crearRol,
  editarRol,
  eliminarRol,
  listarPermisos,
  listarRoles,
} from '../services/roles.service.js';

export async function obtenerPermisos(req, res, next) {
  try {
    res.status(200).json(await listarPermisos());
  } catch (error) { next(error); }
}

export async function obtenerRoles(req, res, next) {
  try {
    res.status(200).json(await listarRoles());
  } catch (error) { next(error); }
}

export async function crearRolControlador(req, res, next) {
  try {
    res.status(201).json(await crearRol(req.body));
  } catch (error) { next(error); }
}

export async function editarRolControlador(req, res, next) {
  try {
    res.status(200).json(await editarRol(req.params.id, req.body));
  } catch (error) { next(error); }
}

export async function cambiarEstadoRolControlador(req, res, next) {
  try {
    res.status(200).json(await cambiarEstadoRol(req.params.id, req.body?.estado));
  } catch (error) { next(error); }
}

export async function eliminarRolControlador(req, res, next) {
  try {
    res.status(200).json(await eliminarRol(req.params.id));
  } catch (error) { next(error); }
}
