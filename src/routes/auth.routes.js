import { Router } from 'express';
import { loginRateLimit, perfilRateLimit } from '../utils/loginLimiter.js';
import { registerRateLimit } from '../utils/registerLimiter.js';
import { activacionRateLimit } from '../utils/activacionLimiter.js';
import { reenvioVerificacionRateLimit } from '../utils/verificacionLimiter.js';
import {
  validarReenvioVerificacion,
  validarVerificacion,
} from '../validators/verificacion.validator.js';
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
  reenviarVerificacionControlador,
  registrar,
  verificarCorreoControlador,
} from '../controllers/auth.controller.js';

const router = Router();

router.post('/auth/register', registerRateLimit, validarRegistro, registrar);
// Verificación de correo (PÚBLICAS, sin sesión). POST y no GET: el enlace del
// correo abre el frontend y es este el que confirma, así los escáneres de
// correo que abren enlaces no consumen el token.
router.post('/auth/verificacion', activacionRateLimit, validarVerificacion, verificarCorreoControlador);
router.post(
  '/auth/verificacion/reenviar',
  validarReenvioVerificacion,
  reenvioVerificacionRateLimit,
  reenviarVerificacionControlador
);
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
