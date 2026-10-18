import { Router } from 'express';
import { cambiarContrasenaRateLimit, loginRateLimit, perfilRateLimit } from '../utils/loginLimiter.js';
import { registerRateLimit } from '../utils/registerLimiter.js';
import {
  validarActualizacionPerfil,
  validarCambioContrasena,
  validarLogin,
  validarRegistro,
} from '../validators/auth.validator.js';
import { verificarToken } from '../middlewares/auth.js';
import {
  actualizarPerfil,
  cambiarContrasena,
  iniciarSesion,
  obtenerPerfil,
  registrar,
} from '../controllers/auth.controller.js';

const router = Router();

router.post('/auth/register', registerRateLimit, validarRegistro, registrar);
router.post('/auth/login', loginRateLimit, validarLogin, iniciarSesion);
router.get('/auth/me', verificarToken, obtenerPerfil);
router.put(
  '/auth/cambiar-contrasena',
  verificarToken,
  cambiarContrasenaRateLimit,
  validarCambioContrasena,
  cambiarContrasena
);
router.put(
  '/auth/perfil',
  verificarToken,
  perfilRateLimit,
  validarActualizacionPerfil,
  actualizarPerfil
);

export default router;
