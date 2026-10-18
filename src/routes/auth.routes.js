import { Router } from 'express';
import { loginRateLimit } from '../utils/loginLimiter.js';
import { cambiarContrasenaRateLimit } from '../utils/loginLimiter.js';
import { registerRateLimit } from '../utils/registerLimiter.js';
import {
  validarCambioContrasena,
  validarLogin,
  validarRegistro,
} from '../validators/auth.validator.js';
import { verificarToken } from '../middlewares/auth.js';
import {
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

export default router;
