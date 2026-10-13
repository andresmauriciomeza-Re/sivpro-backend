import { verificarBaseDatos } from '../services/health.service.js';

export function healthCheck(req, res) {
  res.status(200).json({ ok: true });
}

export async function healthDb(req, res, next) {
  try {
    const resultado = await verificarBaseDatos();
    res.status(200).json(resultado);
  } catch (error) {
    next(error);
  }
}
