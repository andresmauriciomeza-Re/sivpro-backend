import { Router } from 'express';
import AppError from '../errors/AppError.js';
import { verificarToken } from '../middlewares/auth.js';
import { requierePermiso } from '../middlewares/permisos.js';
import {
  actualizarParametrosCostosController,
  obtenerParametrosCostosController,
} from '../controllers/parametrosCostos.controller.js';

const router = Router();

const permisoVerProductos = requierePermiso({
  modulo: 'Producción',
  nombre: 'Productos',
  privilegio: 'Ver',
  mensaje: 'No tienes permiso para consultar los parámetros de costos.',
});

const permisoEditarProductos = requierePermiso({
  modulo: 'Producción',
  nombre: 'Productos',
  privilegio: 'Editar',
  mensaje: 'No tienes permiso para editar los parámetros de costos.',
});

function soloAdministrador(req, res, next) {
  const rol = String(req.usuario?.rol ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
  if (rol !== 'administrador') {
    return next(new AppError('Solo un Administrador puede editar los parámetros de costos.', 403));
  }
  return next();
}

router.get('/parametros-costos', verificarToken, permisoVerProductos, obtenerParametrosCostosController);
router.put(
  '/parametros-costos',
  verificarToken,
  permisoEditarProductos,
  soloAdministrador,
  actualizarParametrosCostosController,
);

export default router;
