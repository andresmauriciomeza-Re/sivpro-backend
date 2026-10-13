import { Router } from 'express';
import { healthCheck, healthDb } from '../controllers/health.controller.js';
import { verificarToken } from '../middlewares/auth.js';

const router = Router();

router.get('/health', healthCheck);
router.get('/health/db', verificarToken, healthDb);

export default router;
