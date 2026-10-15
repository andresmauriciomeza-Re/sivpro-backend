import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import AppError from '../errors/AppError.js';
import { query } from '../config/db.js';
import { enviarCodigoRecuperacion } from './mail.service.js';
import {
  registrarFalloVerificacion,
  reiniciarFallosVerificacion,
} from '../utils/recoveryLimiter.js';

const CODIGO_INVALIDO = 'El código es incorrecto o venció.';
const DEMASIADOS_INTENTOS = 'Demasiados intentos. Solicita un código nuevo.';
const CONTRASENA_ACTUALIZADA =
  'Contraseña actualizada. Ya puedes iniciar sesión.';
const SIN_BASE_DE_DATOS = 'No se pudo conectar con la base de datos.';

const MAX_FALLOS_VERIFICACION = 5;
const HASH_FALSO = bcrypt.hashSync('000000', 10);

const CONSULTA_USUARIO_ACTIVO = `
  SELECT id_usuario, nombre, correo
  FROM tb_usuarios
  WHERE LOWER(correo) = LOWER($1) AND estado = TRUE AND contrasena IS NOT NULL
`;

const ACTUALIZAR_CODIGO = `
  UPDATE tb_usuarios
  SET codigo_recuperacion = $1, codigo_expira = NOW() + INTERVAL '15 minutes'
  WHERE id_usuario = $2
`;

const CONSULTA_CODIGO_VIGENTE = `
  SELECT id_usuario, codigo_recuperacion
  FROM tb_usuarios
  WHERE LOWER(correo) = LOWER($1)
    AND codigo_recuperacion IS NOT NULL
    AND codigo_expira > NOW()
    AND estado = TRUE
`;

const ANULAR_CODIGO = `
  UPDATE tb_usuarios
  SET codigo_recuperacion = NULL, codigo_expira = NULL
  WHERE LOWER(correo) = LOWER($1) AND codigo_recuperacion IS NOT NULL
`;

const RESTABLECER_CONTRASENA = `
  UPDATE tb_usuarios
  SET contrasena = $1, codigo_recuperacion = NULL, codigo_expira = NULL
  WHERE id_usuario = $2 AND codigo_recuperacion = $3
`;

async function consultar(sql, params) {
  try {
    return await query(sql, params);
  } catch (error) {
    console.error('Error de base de datos:', error.code);
    throw new AppError(SIN_BASE_DE_DATOS, 503);
  }
}

export async function procesarSolicitudRecuperacion(correo) {
  try {
    const { rows } = await consultar(CONSULTA_USUARIO_ACTIVO, [correo]);
    const usuario = rows[0];
    if (!usuario) {
      return;
    }

    const codigo = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const hash = await bcrypt.hash(codigo, 10);

    await consultar(ACTUALIZAR_CODIGO, [hash, usuario.id_usuario]);
    reiniciarFallosVerificacion(correo);

    await enviarCodigoRecuperacion(usuario.correo, usuario.nombre, codigo);
  } catch (error) {
    console.error('Error al procesar la recuperación:', error.code);
  }
}

async function validarCodigoActivo(correo, codigo) {
  const claveCorreo = correo.trim().toLowerCase();

  const { rows } = await consultar(CONSULTA_CODIGO_VIGENTE, [correo]);
  const usuario = rows[0];
  const hash = usuario?.codigo_recuperacion || HASH_FALSO;

  let coincide = false;
  try {
    coincide = await bcrypt.compare(codigo, hash);
  } catch (error) {
    coincide = false;
  }

  if (!usuario || !coincide) {
    const fallos = registrarFalloVerificacion(claveCorreo);
    if (fallos >= MAX_FALLOS_VERIFICACION) {
      await consultar(ANULAR_CODIGO, [correo]);
      throw new AppError(DEMASIADOS_INTENTOS, 429);
    }
    throw new AppError(CODIGO_INVALIDO, 400);
  }

  return usuario;
}

export async function verificarCodigoRecuperacion(correo, codigo) {
  await validarCodigoActivo(correo, codigo);
  return { valido: true };
}

export async function restablecerContrasena(correo, codigo, contrasena) {
  const usuario = await validarCodigoActivo(correo, codigo);

  const hashContrasena = await bcrypt.hash(contrasena, 10);

  const { rowCount } = await consultar(RESTABLECER_CONTRASENA, [
    hashContrasena,
    usuario.id_usuario,
    usuario.codigo_recuperacion,
  ]);

  if (rowCount === 0) {
    throw new AppError(CODIGO_INVALIDO, 400);
  }

  return { mensaje: CONTRASENA_ACTUALIZADA };
}
