import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import AppError from '../errors/AppError.js';
import { query } from '../config/db.js';

// Activación de la cuenta de empleado (público, sin token de sesión). El enlace
// del correo trae el token en claro; en la base solo vive su hash SHA-256 junto
// con su vencimiento (columnas token_activacion / token_activacion_expira).
// Un solo uso: al guardar la contraseña el token se borra en la misma
// sentencia, así dos personas no pueden activar con el mismo enlace.
const ENLACE_INVALIDO =
  'El enlace venció o ya fue usado. Pide a la administración que te reenvíe la invitación.';
const CONTRASENA_CREADA = 'Contraseña creada. Ya puedes iniciar sesión.';

const hashDeToken = (token) =>
  crypto.createHash('sha256').update(String(token)).digest('hex');

/** "sebastian@dominio.com" → "s•••@dominio.com" (nunca se expone el correo). */
function enmascararCorreo(correo) {
  const texto = String(correo ?? '').trim();
  if (!texto) return '';
  const [local, dominio] = texto.split('@');
  return `${(local ?? '')[0] ?? ''}•••@${dominio ?? ''}`;
}

/** GET /auth/activacion/:token: valida el enlace y devuelve SOLO lo necesario
 *  para el saludo del modal (nombre y correo enmascarado). */
export async function obtenerDatosActivacion(token) {
  const { rows } = await query(
    `SELECT nombre, correo
       FROM tb_usuarios
      WHERE token_activacion = $1
        AND token_activacion_expira > NOW()`,
    [hashDeToken(token)]
  );
  const usuario = rows[0];
  if (!usuario) throw new AppError(ENLACE_INVALIDO, 400);

  return {
    nombre: usuario.nombre,
    correoEnmascarado: enmascararCorreo(usuario.correo),
  };
}

/** POST /auth/activacion: guarda la contraseña con bcrypt, invalida el enlace
 *  y devuelve el correo real para precargar el inicio de sesión. */
export async function activarCuenta(token, contrasena) {
  const hashContrasena = await bcrypt.hash(contrasena, 10);

  const { rows } = await query(
    `UPDATE tb_usuarios
        SET contrasena = $1,
            token_version = token_version + 1,
            token_activacion = NULL,
            token_activacion_expira = NULL
      WHERE token_activacion = $2
        AND token_activacion_expira > NOW()
      RETURNING id_usuario, correo`,
    [hashContrasena, hashDeToken(token)]
  );
  const usuario = rows[0];
  if (!usuario) throw new AppError(ENLACE_INVALIDO, 400);

  return { mensaje: CONTRASENA_CREADA, correo: usuario.correo };
}
