import { Router } from 'express';
import { loginRateLimit } from '../utils/loginLimiter.js';
import { validarLogin } from '../validators/auth.validator.js';
import { verificarToken } from '../middlewares/auth.js';
import { iniciarSesion, obtenerPerfil } from '../controllers/auth.controller.js';

const router = Router();

router.post('/auth/login', loginRateLimit, validarLogin, iniciarSesion);
router.get('/auth/me', verificarToken, obtenerPerfil);

export default router;
