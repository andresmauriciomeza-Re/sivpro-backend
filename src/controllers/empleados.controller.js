import {
  crearEmpleado,
  listarInvitacionesPendientes,
  reenviarInvitacion,
} from '../services/empleados.service.js';

export async function crearEmpleadoControlador(req, res, next) {
  try {
    res.status(201).json(await crearEmpleado(req.body));
  } catch (error) { next(error); }
}

export async function reenviarInvitacionControlador(req, res, next) {
  try {
    res.status(200).json(await reenviarInvitacion(req.params.id));
  } catch (error) { next(error); }
}

export async function invitacionesPendientesControlador(req, res, next) {
  try {
    res.status(200).json(await listarInvitacionesPendientes());
  } catch (error) { next(error); }
}
