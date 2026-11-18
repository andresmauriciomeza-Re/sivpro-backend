import assert from 'node:assert/strict';
import test from 'node:test';
import { validateFile, fileFilter, MAX_FILE_SIZE } from '../src/validators/file.validator.js';

const pdf = { mimetype: 'application/pdf', size: 12, buffer: Buffer.from('%PDF-1.7\n') };

test('admite PDF en comprobantes y conserva imágenes en otras carpetas', () => {
  validateFile(pdf, 'comprobantes');
  validateFile({ mimetype: 'image/png', size: 1 }, 'productos');
  validateFile({ mimetype: 'image/png', size: 8, buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) }, 'comprobantes');
  fileFilter({}, pdf, (error, aceptado) => {
    assert.equal(error, null);
    assert.equal(aceptado, true);
  });
});

test('rechaza PDF fuera de comprobantes, inválidos o mayores de 5 MB', () => {
  assert.throws(() => validateFile(pdf, 'productos'), /solo se permiten en comprobantes/);
  assert.throws(() => validateFile({ ...pdf, buffer: Buffer.from('imagen') }, 'comprobantes'), /PDF válido/);
  assert.throws(() => validateFile({ ...pdf, size: MAX_FILE_SIZE + 1 }, 'comprobantes'), /5 MB/);
  assert.throws(() => validateFile({ ...pdf, mimetype: 'image/png' }, 'comprobantes'), /no coincide/);
});
