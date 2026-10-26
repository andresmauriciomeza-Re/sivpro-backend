import {
  cambiarEstadoEmpleado,
  crearContratacion,
  crearEmpleado,
  editarEmpleado,
  listarCargos,
  listarEmpleados,
  listarInvitacionesPendientes,
  miContratacion,
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

export async function listarEmpleadosControlador(req, res, next) {
  try {
    res.status(200).json(await listarEmpleados());
  } catch (error) { next(error); }
}

export async function listarCargosControlador(req, res, next) {
  try {
    res.status(200).json(await listarCargos());
  } catch (error) { next(error); }
}

export async function miContratacionControlador(req, res, next) {
  try {
    res.status(200).json(await miContratacion(req.usuario.id));
  } catch (error) { next(error); }
}

export async function editarEmpleadoControlador(req, res, next) {
  try {
    res.status(200).json(await editarEmpleado(Number(req.params.id), req.body));
  } catch (error) { next(error); }
}

export async function cambiarEstadoEmpleadoControlador(req, res, next) {
  try {
    res.status(200).json(await cambiarEstadoEmpleado(Number(req.params.id), req.body.estado));
  } catch (error) { next(error); }
}

export async function crearContratacionControlador(req, res, next) {
  try {
    res.status(201).json(await crearContratacion(Number(req.params.id), req.body));
  } catch (error) { next(error); }
}
