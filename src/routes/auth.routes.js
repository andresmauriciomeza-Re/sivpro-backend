import { Router } from 'express';
import { loginRateLimit, perfilRateLimit } from '../utils/loginLimiter.js';
import { registerRateLimit } from '../utils/registerLimiter.js';
import {
  validarActualizacionPerfil,
  validarLogin,
  validarRegistro,
} from '../validators/auth.validator.js';
import { verificarToken } from '../middlewares/auth.js';
import {
  actualizarPerfil,
  iniciarSesion,
  obtenerPerfil,
  registrar,
} from '../controllers/auth.controller.js';

const router = Router();

router.post('/auth/register', registerRateLimit, validarRegistro, registrar);
router.post('/auth/login', loginRateLimit, validarLogin, iniciarSesion);
router.get('/auth/me', verificarToken, obtenerPerfil);
router.put(
  '/auth/perfil',
  verificarToken,
  perfilRateLimit,
  validarActualizacionPerfil,
  actualizarPerfil
);

export default router;
