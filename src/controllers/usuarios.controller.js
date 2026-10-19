import { eliminarUsuario } from '../services/usuarios.service.js';

export async function borrarUsuario(req, res, next) {
  try {
    const resultado = await eliminarUsuario(req.params.id, req.usuario.id);
    res.status(200).json(resultado);
  } catch (error) {
    next(error);
  }
}
