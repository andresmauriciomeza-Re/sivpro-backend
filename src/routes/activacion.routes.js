import { Router } from 'express';
import { activacionRateLimit } from '../utils/activacionLimiter.js';
import {
  validarActivacion,
  validarTokenActivacionParam,
} from '../validators/activacion.validator.js';
import {
  activarCuentaControlador,
  consultarActivacion,
} from '../controllers/activacion.controller.js';

const router = Router();

// Rutas PÚBLICAS (el empleado aún no tiene sesión): solo validan el token de
// un solo uso del correo, con limitador de solicitudes.
router.get(
  '/auth/activacion/:token',
  activacionRateLimit,
  validarTokenActivacionParam,
  consultarActivacion
);

router.post(
  '/auth/activacion',
  activacionRateLimit,
  validarActivacion,
  activarCuentaControlador
);

export default router;
