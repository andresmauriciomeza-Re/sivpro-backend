import AppError from '../errors/AppError.js';

export const MAX_FILE_SIZE = 5 * 1024 * 1024;

export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
];

export const ALLOWED_FOLDERS = [
  'productos',
  'comprobantes',
  'proveedores',
  'no-conformes',
];

export const DEFAULT_FOLDER = 'otros';

export function fileFilter(req, file, cb) {
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    return cb(
      new AppError('Tipo de archivo no permitido. Use JPG, PNG, WEBP o PDF.', 415)
    );
  }
  cb(null, true);
}

export function validateFile(file) {
  if (!file) {
    throw new AppError('El campo "archivo" es obligatorio.', 400);
  }
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    throw new AppError(
      'Tipo de archivo no permitido. Use JPG, PNG, WEBP o PDF.',
      415
    );
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new AppError('El archivo supera el máximo permitido de 5 MB.', 413);
  }
}

export function normalizeFolder(value) {
  const carpeta = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return ALLOWED_FOLDERS.includes(carpeta) ? carpeta : DEFAULT_FOLDER;
}
