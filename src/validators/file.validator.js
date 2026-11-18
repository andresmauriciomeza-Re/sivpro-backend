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

export function validateFile(file, carpeta) {
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
  if (file.mimetype === 'application/pdf') {
    if (carpeta !== 'comprobantes') throw new AppError('Los PDF solo se permiten en comprobantes.', 415);
    if (!Buffer.isBuffer(file.buffer) || file.buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new AppError('El archivo no es un PDF válido.', 415);
    }
  } else if (carpeta === 'comprobantes') {
    const bytes = file.buffer;
    const valido = Buffer.isBuffer(bytes) && (
      (file.mimetype === 'image/jpeg' && bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) ||
      (file.mimetype === 'image/png' && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ||
      (file.mimetype === 'image/webp' && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP')
    );
    if (!valido) throw new AppError('El contenido de la imagen no coincide con su tipo.', 415);
  }
}

export function normalizeFolder(value) {
  const carpeta = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return ALLOWED_FOLDERS.includes(carpeta) ? carpeta : DEFAULT_FOLDER;
}
