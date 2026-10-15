import { Router } from 'express';
import { solicitarRateLimit } from '../utils/recoveryLimiter.js';
import {
  validarSolicitudRecuperacion,
  validarVerificacionCodigo,
  validarRestablecimiento,
} from '../validators/recuperacion.validator.js';
import {
  solicitarCodigo,
  verificarCodigo,
  restablecer,
} from '../controllers/recuperacion.controller.js';

const router = Router();

router.post(
  '/auth/recuperar/solicitar',
  validarSolicitudRecuperacion,
  solicitarRateLimit,
  solicitarCodigo
);

router.post(
  '/auth/recuperar/verificar',
  validarVerificacionCodigo,
  verificarCodigo
);

router.post(
  '/auth/recuperar/restablecer',
  validarRestablecimiento,
  restablecer
);

export default router;
