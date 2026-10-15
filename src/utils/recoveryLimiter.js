import AppError from '../errors/AppError.js';

const MENSAJE_LIMITE = 'Espera un momento antes de pedir otro código.';
const MAX_POR_IP = 10;
const MAX_POR_CORREO = 5;
const VENTANA_MS = 60 * 60 * 1000;
const INTERVALO_MINIMO_MS = 30 * 1000;

const porIp = new Map();
const porCorreo = new Map();
const fallosVerificacion = new Map();

function crearClaveCorreo(correo) {
  return typeof correo === 'string' ? correo.trim().toLowerCase() : '';
}

function obtenerEntrada(mapa, clave) {
  const entrada = mapa.get(clave);
  if (!entrada) {
    return undefined;
  }
  if (Date.now() - entrada.inicio > VENTANA_MS) {
    mapa.delete(clave);
    return undefined;
  }
  return entrada;
}

export function solicitarRateLimit(req, res, next) {
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

  registrarSolicitud(ip, correo);
  next();
}

function registrarSolicitud(ip, correo) {
  const ahora = Date.now();

  const entradaIp = obtenerEntrada(porIp, ip);
  if (entradaIp) {
    entradaIp.total += 1;
  } else {
    porIp.set(ip, { total: 1, inicio: ahora });
  }

  const entradaCorreo = obtenerEntrada(porCorreo, correo);
  if (entradaCorreo) {
    entradaCorreo.total += 1;
    entradaCorreo.ultimo = ahora;
  } else {
    porCorreo.set(correo, { total: 1, inicio: ahora, ultimo: ahora });
  }
}

export function registrarFalloVerificacion(claveCorreo) {
  const clave = crearClaveCorreo(claveCorreo);
  const entrada = obtenerEntrada(fallosVerificacion, clave);
  if (entrada) {
    entrada.fallos += 1;
  } else {
    fallosVerificacion.set(clave, { fallos: 1, inicio: Date.now() });
  }
  return fallosVerificacion.get(clave).fallos;
}

export function reiniciarFallosVerificacion(claveCorreo) {
  fallosVerificacion.delete(crearClaveCorreo(claveCorreo));
}
