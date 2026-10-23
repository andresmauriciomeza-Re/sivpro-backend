import AppError from '../errors/AppError.js';

// Limitador de POST /auth/verificacion/reenviar (público). Mismo estilo
// in-memory que recoveryLimiter: contador por IP y por correo en una ventana
// de una hora, con un intervalo mínimo entre envíos al mismo correo.
const MENSAJE_LIMITE = 'Espera un momento antes de pedir otro correo de confirmación.';
const MAX_POR_IP = 10;
const MAX_POR_CORREO = 3;
const VENTANA_MS = 60 * 60 * 1000;
const INTERVALO_MINIMO_MS = 60 * 1000;

const porIp = new Map();
const porCorreo = new Map();

function crearClaveCorreo(correo) {
  return typeof correo === 'string' ? correo.trim().toLowerCase() : '';
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

function sumar(mapa, clave, ahora) {
  if (!clave) return;
  const entrada = obtenerEntrada(mapa, clave);
  if (entrada) {
    entrada.total += 1;
    entrada.ultimo = ahora;
    return;
  }
  mapa.set(clave, { total: 1, inicio: ahora, ultimo: ahora });
}

export function reenvioVerificacionRateLimit(req, res, next) {
  const ip = req.ip;
  const correo = crearClaveCorreo(req.body?.correo);

  const entradaIp = obtenerEntrada(porIp, ip);
  if (entradaIp && entradaIp.total >= MAX_POR_IP) {
    return next(new AppError(MENSAJE_LIMITE, 429));
  }

  const entradaCorreo = obtenerEntrada(porCorreo, correo);
  if (entradaCorreo) {
    if (Date.now() - entradaCorreo.ultimo < INTERVALO_MINIMO_MS) {
      return next(new AppError(MENSAJE_LIMITE, 429));
    }
    if (entradaCorreo.total >= MAX_POR_CORREO) {
      return next(new AppError(MENSAJE_LIMITE, 429));
    }
  }

  const ahora = Date.now();
  sumar(porIp, ip, ahora);
  sumar(porCorreo, correo, ahora);
  next();
}
