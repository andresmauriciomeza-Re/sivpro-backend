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

// ── Actualización de perfil (PUT /auth/perfil) ─────────────────────────
// Mismo estilo que las demás rutas de auth: cuenta cada intento (no solo los
// fallos, porque aquí no hay contraseña que adivinar) y bloquea con 429.

const MAX_INTENTOS_PERFIL = 10;
const VENTANA_PERFIL_MS = 15 * 60 * 1000;
const perfiles = new Map();

function crearClavePerfil(idUsuario, ip) {
  const id = typeof idUsuario === 'string' || typeof idUsuario === 'number'
    ? String(idUsuario)
    : '';
  return `${id}|${ip}`;
}

function obtenerEntradaPerfil(clave) {
  const entrada = perfiles.get(clave);
  if (!entrada) {
    return undefined;
  }
  if (Date.now() - entrada.inicio > VENTANA_PERFIL_MS) {
    perfiles.delete(clave);
    return undefined;
  }
  return entrada;
}

export function perfilRateLimit(req, res, next) {
  const clave = crearClavePerfil(req.usuario?.id, req.ip);
  const entrada = obtenerEntradaPerfil(clave);

  if (entrada && entrada.total >= MAX_INTENTOS_PERFIL) {
    return next(
      new AppError(
        'Demasiadas actualizaciones de perfil. Intenta de nuevo más tarde.',
        429
      )
    );
  }

  req.claveIntentoPerfil = clave;
  next();
}

export function registrarIntentoPerfil(clave) {
  const entrada = obtenerEntradaPerfil(clave);
  if (entrada) {
    entrada.total += 1;
  } else {
    perfiles.set(clave, { total: 1, inicio: Date.now() });
  }
}
