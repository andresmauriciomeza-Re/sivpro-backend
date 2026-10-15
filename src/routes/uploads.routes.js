import { Router } from 'express';
import { uploadMiddleware } from '../middlewares/upload.js';
import normalizeFolderMiddleware from '../middlewares/normalizeFolder.js';
import { verificarToken } from '../middlewares/auth.js';
import { uploadRateLimit } from '../utils/uploadLimiter.js';
import { uploadFile } from '../controllers/upload.controller.js';

const router = Router();

router.post(
  '/uploads',
  verificarToken,
  uploadRateLimit,
  uploadMiddleware,
  normalizeFolderMiddleware,
  uploadFile
);

export default router;
