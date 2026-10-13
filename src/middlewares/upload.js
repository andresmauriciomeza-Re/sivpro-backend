import multer from 'multer';
import { MAX_FILE_SIZE, fileFilter } from '../validators/file.validator.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter,
});

export const uploadMiddleware = upload.single('archivo');
