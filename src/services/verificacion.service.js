import crypto from 'node:crypto';
import AppError from '../errors/AppError.js';
import { query } from '../config/db.js';
import { enviarCorreoVerificacion } from './mail.service.js';
import { ENLACE_VERIFICACION_INVALIDO } from '../validators/verificacion.validator.js';

// Verificación de correo del registro público. Reutiliza las columnas de la
// invitación de empleado (token_activacion / token_activacion_expira): al
// correo va el token en claro y en la base solo vive su hash SHA-256. Mientras
// el token exista, el login responde "Tu cuenta aún no está activada".
// Solo aplica a clientes que NO son empleados: así un token de invitación de
// empleado nunca se consume aquí (el empleado debe crear su contraseña).
export const HORAS_VIGENCIA_VERIFICACION = 24;

const CORREO_VERIFICADO = 'Correo verificado. Ya puedes iniciar sesión.';
const REENVIO_GENERICO =
  'Si tu cuenta está pendiente de confirmar, te enviamos un correo nuevo.';
const SIN_BASE_DE_DATOS = 'No se pudo conectar con la base de datos.';

const SOLO_CLIENTE = `
  EXISTS (SELECT 1 FROM tb_cliente c WHERE c.id_usuario = u.id_usuario)
  AND NOT EXISTS (SELECT 1 FROM tb_empleado e WHERE e.id_usuario = u.id_usuario)
`;

const hashDeToken = (token) =>
  crypto.createHash('sha256').update(String(token)).digest('hex');

/** Token de un solo uso: el claro va al correo y el hash a la base. */
export function generarTokenVerificacion() {
  const token = crypto.randomBytes(32).toString('hex');
  return {
    token,
    hash: hashDeToken(token),
    vencimiento: new Date(Date.now() + HORAS_VIGENCIA_VERIFICACION * 60 * 60 * 1000),
  };
}

async function consultar(sql, params) {
  try {
    return await query(sql, params);
  } catch (error) {
    console.error('Error de base de datos:', error.code);
    throw new AppError(SIN_BASE_DE_DATOS, 503);
  }
}

/** POST /auth/verificacion: invalida el token en la misma sentencia (un solo
 *  uso) y devuelve los datos para el correo de bienvenida. */
export async function verificarCorreo(token) {
  const { rows } = await consultar(
    `UPDATE tb_usuarios u
        SET token_activacion = NULL,
            token_activacion_expira = NULL
      WHERE u.token_activacion = $1
        AND u.token_activacion_expira > NOW()
        AND ${SOLO_CLIENTE}
      RETURNING u.id_usuario, u.tipo_documento, u.nombre, u.correo, u.telefono`,
    [hashDeToken(token)]
  );
  const usuario = rows[0];
  if (!usuario) throw new AppError(ENLACE_VERIFICACION_INVALIDO, 400);

  return {
    mensaje: CORREO_VERIFICADO,
    correo: usuario.correo,
    usuario: {
      nombre: usuario.nombre,
      correo: usuario.correo,
      telefono: usuario.telefono ?? '',
      tipoDocumento: usuario.tipo_documento ?? '',
      numeroDocumento: String(usuario.id_usuario),
    },
  };
}

/** POST /auth/verificacion/reenviar: si el correo es de un cliente pendiente,
 *  genera un token NUEVO (el anterior deja de servir) y reenvía el correo.
 *  Responde SIEMPRE lo mismo, exista o no la cuenta. */
export async function reenviarVerificacion(correo) {
  const { rows } = await consultar(
    `SELECT u.id_usuario, u.nombre, u.correo
       FROM tb_usuarios u
      WHERE LOWER(u.correo) = LOWER($1)
        AND u.token_activacion IS NOT NULL
        AND ${SOLO_CLIENTE}`,
    [correo]
  );
  const usuario = rows[0];
  if (usuario) {
    const { token, hash, vencimiento } = generarTokenVerificacion();
    await consultar(
      `UPDATE tb_usuarios
          SET token_activacion = $1,
              token_activacion_expira = NOW() + ($2::int * INTERVAL '1 hour')
        WHERE id_usuario = $3
          AND token_activacion IS NOT NULL`,
      [hash, HORAS_VIGENCIA_VERIFICACION, usuario.id_usuario]
    );
    await enviarCorreoVerificacion({
      nombre: usuario.nombre,
      correo: usuario.correo,
      token,
      vencimiento,
    });
  }
  return { mensaje: REENVIO_GENERICO };
}
