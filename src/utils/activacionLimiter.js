import AppError from '../errors/AppError.js';

// Limitador de los endpoints PÚBLICOS de activación de cuenta
// (GET/POST /auth/activacion). Mismo estilo in-memory que recoveryLimiter:
// contador por IP y por token en una ventana de una hora. El token son 32 bytes
// aleatorios, así que la fuerza bruta es imposible; esto solo frena el tráfico
// basura y los reintentos automáticos.
const MENSAJE_LIMITE = 'Demasiadas solicitudes. Intenta de nuevo más tarde.';
const MAX_POR_IP = 30;
const MAX_POR_TOKEN = 10;
const VENTANA_MS = 60 * 60 * 1000;

const porIp = new Map();
const porToken = new Map();

function claveToken(req) {
  const token = typeof req.params?.token === 'string'
    ? req.params.token
    : typeof req.body?.token === 'string'
      ? req.body.token
      : '';
  return token.trim().toLowerCase();
}

function obtenerEntrada(mapa, clave) {
  if (!clave) return undefined;
  const entrada = mapa.get(clave);
  if (!entrada) return undefined;
  if (Date.now() - entrada.inicio > VENTANA_MS) {
    mapa.delete(clave);
    return undefined;
  }
  return entrada;
}

function sumar(mapa, clave) {
  const entrada = obtenerEntrada(mapa, clave);
  if (entrada) {
    entrada.total += 1;
    return;
  }
  mapa.set(clave, { total: 1, inicio: Date.now() });
}

export function activacionRateLimit(req, res, next) {
  const ip = req.ip;
  const token = claveToken(req);

  const entradaIp = obtenerEntrada(porIp, ip);
  if (entradaIp && entradaIp.total >= MAX_POR_IP) {
    return next(new AppError(MENSAJE_LIMITE, 429));
  }

  const entradaToken = obtenerEntrada(porToken, token);
  if (entradaToken && entradaToken.total >= MAX_POR_TOKEN) {
    return next(new AppError(MENSAJE_LIMITE, 429));
  }

  sumar(porIp, ip);
  sumar(porToken, token);
  next();
}
