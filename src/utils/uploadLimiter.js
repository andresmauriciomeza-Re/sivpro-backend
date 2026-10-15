import AppError from '../errors/AppError.js';

const MAX_SUBIDAS = 20;
const VENTANA_MS = 15 * 60 * 1000;

const subidas = new Map();

function obtenerEntrada(clave) {
  const entrada = subidas.get(clave);
  if (!entrada) {
    return undefined;
  }
  if (Date.now() - entrada.inicio > VENTANA_MS) {
    subidas.delete(clave);
    return undefined;
  }
  return entrada;
}

export function uploadRateLimit(req, res, next) {
  const clave = req.ip;
  let entrada = obtenerEntrada(clave);

  if (entrada && entrada.total >= MAX_SUBIDAS) {
    return next(
      new AppError(
        'Demasiadas subidas desde esta IP. Intente de nuevo más tarde.',
        429
      )
    );
  }

  if (entrada) {
    entrada.total += 1;
  } else {
    subidas.set(clave, { total: 1, inicio: Date.now() });
  }

  next();
}
