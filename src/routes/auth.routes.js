import { Router } from 'express';
import { loginRateLimit } from '../utils/loginLimiter.js';
import { registerRateLimit } from '../utils/registerLimiter.js';
import { validarLogin, validarRegistro } from '../validators/auth.validator.js';
import { verificarToken } from '../middlewares/auth.js';
import {
  iniciarSesion,
  obtenerPerfil,
  registrar,
} from '../controllers/auth.controller.js';

const router = Router();

router.post('/auth/register', registerRateLimit, validarRegistro, registrar);
router.post('/auth/login', loginRateLimit, validarLogin, iniciarSesion);
router.get('/auth/me', verificarToken, obtenerPerfil);

export default router;
