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

// ── Cambio de contraseña (PUT /auth/cambiar-contrasena) ─────────────────
// Mismos umbrales que el login (5 fallos en 15 minutos), pero la clave es el
// id del usuario autenticado + IP: así se frena el intento de adivinar la
// contraseña actual sin que el usuario deba escribir su correo en el body.

const MAX_INTENTOS_CAMBIO = 5;
const VENTANA_CAMBIO_MS = 15 * 60 * 1000;
const cambios = new Map();

function crearClaveCambio(idUsuario, ip) {
  const id = typeof idUsuario === 'string' || typeof idUsuario === 'number'
    ? String(idUsuario)
    : '';
  return `${id}|${ip}`;
}

function obtenerEntradaCambio(clave) {
  const entrada = cambios.get(clave);
  if (!entrada) {
    return undefined;
  }
  if (Date.now() - entrada.inicio > VENTANA_CAMBIO_MS) {
    cambios.delete(clave);
    return undefined;
  }
  return entrada;
}

export function cambiarContrasenaRateLimit(req, res, next) {
  const clave = crearClaveCambio(req.usuario?.id, req.ip);
  const entrada = obtenerEntradaCambio(clave);

  if (entrada && entrada.fallos >= MAX_INTENTOS_CAMBIO) {
    return next(
      new AppError(
        'Demasiados intentos de cambio de contraseña. Intente de nuevo más tarde.',
        429
      )
    );
  }

  req.claveIntentoCambio = clave;
  next();
}

export function registrarFalloCambioContrasena(clave) {
  const entrada = obtenerEntradaCambio(clave);
  if (entrada) {
    entrada.fallos += 1;
  } else {
    cambios.set(clave, { fallos: 1, inicio: Date.now() });
  }
}

export function reiniciarCambioContrasena(clave) {
  cambios.delete(clave);
}
