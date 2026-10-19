import { eliminarUsuario, listarClientes, listarUsuarios } from '../services/usuarios.service.js';

export async function obtenerUsuarios(req, res, next) {
  try {
    res.status(200).json(await listarUsuarios());
  } catch (error) {
    next(error);
  }
}

export async function obtenerClientes(req, res, next) {
  try {
    res.status(200).json(await listarClientes());
  } catch (error) {
    next(error);
  }
}

export async function borrarUsuario(req, res, next) {
  try {
    const resultado = await eliminarUsuario(req.params.id, req.usuario.id);
    res.status(200).json(resultado);
  } catch (error) {
    next(error);
  }
}
