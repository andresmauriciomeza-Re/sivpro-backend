import AppError from '../errors/AppError.js';

const MAX_INTENTOS = 5;
const VENTANA_MS = 15 * 60 * 1000;

const intentos = new Map();

function crearClave(correo, ip) {
  const normalizado =
    typeof correo === 'string' ? correo.trim().toLowerCase() : '';
  return `${normalizado}|${ip}`;
}

function obtenerEntrada(clave) {
  const entrada = intentos.get(clave);
  if (!entrada) {
    return undefined;
  }
  if (Date.now() - entrada.inicio > VENTANA_MS) {
    intentos.delete(clave);
    return undefined;
  }
  return entrada;
}

export function loginRateLimit(req, res, next) {
  const clave = crearClave(req.body?.correo, req.ip);
  const entrada = obtenerEntrada(clave);

  if (entrada && entrada.fallos >= MAX_INTENTOS) {
    return next(
      new AppError(
        'Demasiados intentos de inicio de sesión. Intente de nuevo más tarde.',
        429
      )
    );
  }

  req.claveIntento = clave;
  next();
}

export function registrarFallo(clave) {
  const entrada = obtenerEntrada(clave);
  if (entrada) {
    entrada.fallos += 1;
  } else {
    intentos.set(clave, { fallos: 1, inicio: Date.now() });
  }
}

export function reiniciarIntentos(clave) {
  intentos.delete(clave);
}
