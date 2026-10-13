import { normalizeFolder } from '../validators/file.validator.js';

export default function normalizeFolderMiddleware(req, res, next) {
  req.body = req.body || {};
  req.body.carpeta = normalizeFolder(req.body.carpeta);
  next();
}
