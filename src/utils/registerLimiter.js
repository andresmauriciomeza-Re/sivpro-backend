import AppError from '../errors/AppError.js';

const MAX_REGISTROS = 10;
const VENTANA_MS = 60 * 60 * 1000;

const registros = new Map();

function obtenerEntrada(clave) {
  const entrada = registros.get(clave);
  if (!entrada) {
    return undefined;
  }
  if (Date.now() - entrada.inicio > VENTANA_MS) {
    registros.delete(clave);
    return undefined;
  }
  return entrada;
}

export function registerRateLimit(req, res, next) {
  const clave = req.ip;
  const entrada = obtenerEntrada(clave);

  if (entrada && entrada.total >= MAX_REGISTROS) {
    return next(
      new AppError(
        'Demasiados registros desde esta IP. Intenta de nuevo más tarde.',
        429
      )
    );
  }

  req.claveRegistro = clave;
  next();
}

export function registrarIntento(clave) {
  const entrada = obtenerEntrada(clave);
  if (entrada) {
    entrada.total += 1;
  } else {
    registros.set(clave, { total: 1, inicio: Date.now() });
  }
}
