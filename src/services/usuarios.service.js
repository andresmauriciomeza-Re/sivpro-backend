import AppError from '../errors/AppError.js';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { query, transaction } from '../config/db.js';
import { contratoVigenteSql } from '../utils/contratacion.js';
import { enviarCorreoBienvenida } from './mail.service.js';

const superAdminId = () => String(process.env.SUPER_ADMIN_ID || '').trim();
const esSuperAdminId = (id) => Boolean(superAdminId()) && String(id) === superAdminId();
const normalizarNombre = (valor) => {
  const minusculas = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e']);
  return String(valor ?? '').trim().toLocaleLowerCase('es').split(/\s+/).filter(Boolean)
    .map((palabra, indice) => indice > 0 && minusculas.has(palabra)
      ? palabra
      : palabra.charAt(0).toLocaleUpperCase('es') + palabra.slice(1)).join(' ');
};

const CONSULTA_USUARIO = `
  SELECT u.id_usuario, u.nombre, u.correo, u.estado, u.id_rol, r.nombre AS rol
  FROM tb_usuarios u
  LEFT JOIN tb_roles r ON r.id_rol = u.id_rol
  WHERE u.id_usuario = $1
`;

const CONSULTA_ADMINISTRADORES_ACTIVOS = `
  SELECT COUNT(DISTINCT u.id_usuario)::int AS cantidad
  FROM tb_usuarios u
  WHERE u.estado = TRUE AND (
    EXISTS (
      SELECT 1 FROM tb_roles r
      WHERE r.id_rol = u.id_rol AND LOWER(r.nombre) = 'administrador'
    ) OR EXISTS (
      SELECT 1
      FROM tb_empleado e
      JOIN tb_contratacion_empleado ce ON ce.id_empleado = e.id_empleado AND ${contratoVigenteSql('ce')}
      JOIN tb_empleado_roles er ON er.id_contrato = ce.id_contrato
      JOIN tb_roles r ON r.id_rol = er.id_rol
      WHERE e.id_usuario = u.id_usuario AND LOWER(r.nombre) = 'administrador'
    )
  )
`;

async function protegerUltimoAdministrador(idObjetivo) {
  const [objetivo, activos] = await Promise.all([
    query(`
      SELECT EXISTS (
        SELECT 1 FROM tb_roles r WHERE r.id_rol = u.id_rol AND LOWER(r.nombre) = 'administrador'
      ) OR EXISTS (
        SELECT 1 FROM tb_empleado e
        JOIN tb_contratacion_empleado ce ON ce.id_empleado = e.id_empleado AND ${contratoVigenteSql('ce')}
        JOIN tb_empleado_roles er ON er.id_contrato = ce.id_contrato
        JOIN tb_roles r ON r.id_rol = er.id_rol
        WHERE e.id_usuario = u.id_usuario AND LOWER(r.nombre) = 'administrador'
      ) AS es_administrador
      FROM tb_usuarios u WHERE u.id_usuario = $1 AND u.estado = TRUE
    `, [String(idObjetivo)]),
    query(CONSULTA_ADMINISTRADORES_ACTIVOS, []),
  ]);
  if (objetivo.rows[0]?.es_administrador && Number(activos.rows[0]?.cantidad ?? 0) <= 1) {
    throw new AppError('No se puede desactivar o eliminar al último administrador activo.', 403);
  }
}

const CONSULTA_ASOCIADOS = `
  SELECT
    (SELECT COUNT(*)
       FROM tb_venta v
       JOIN tb_cliente c ON c.id_cliente = v.id_cliente
      WHERE c.id_usuario = $1) AS ventas,
    (SELECT COUNT(*)
       FROM tb_contratacion_empleado ce
       JOIN tb_empleado e ON e.id_empleado = ce.id_empleado
      WHERE e.id_usuario = $1) AS contrataciones
`;

// Elimina la cuenta del panel (y sus fichas de cliente/empleado) o la
// desactiva si tiene ventas o contrataciones asociadas, sin romper la
// integridad referencial. Nunca borra al super administrador, la propia
// cuenta del solicitante, ni deja el sistema sin un administrador activo.
export async function eliminarUsuario(idObjetivo, idSolicitante) {
  idObjetivo = String(idObjetivo);
  if (idObjetivo === String(idSolicitante)) {
    throw new AppError('No puedes eliminar tu propia cuenta.', 403);
  }

  const { rows } = await query(CONSULTA_USUARIO, [idObjetivo]);
  const objetivo = rows[0];
  if (!objetivo) {
    throw new AppError('Usuario no encontrado.', 404);
  }

  if (esSuperAdminId(idObjetivo)) {
    throw new AppError('La cuenta de super administrador no se puede eliminar.', 403);
  }

  if (objetivo.estado) await protegerUltimoAdministrador(idObjetivo);

  const { rows: asociados } = await query(CONSULTA_ASOCIADOS, [idObjetivo]);
  const ventas = Number(asociados[0].ventas);
  const contrataciones = Number(asociados[0].contrataciones);

  if (ventas > 0 || contrataciones > 0) {
    // Con historial de ventas o contrataciones la cuenta no se borra: se
    // desactiva (usuarios + fichas), conservando las filas referenciadas.
    await transaction(async (client) => {
      await client.query(
        'UPDATE tb_usuarios SET estado = FALSE, token_version = token_version + 1 WHERE id_usuario = $1',
        [idObjetivo]
      );
      await client.query(
        'UPDATE tb_cliente SET estado = FALSE WHERE id_usuario = $1',
        [idObjetivo]
      );
      await client.query(
        'UPDATE tb_empleado SET estado = FALSE WHERE id_usuario = $1',
        [idObjetivo]
      );
    });
    return {
      accion: 'desactivado',
      mensaje:
        'La cuenta tiene ventas o contrataciones asociadas, así que no se eliminó: se desactivó en su lugar.',
    };
  }

  // Sin registros asociados se borra todo en orden (hijos primero):
  // tb_empleado_roles cae en cascada al borrar la contratación.
  await transaction(async (client) => {
    await client.query(
      'DELETE FROM tb_contratacion_empleado WHERE id_empleado IN (SELECT id_empleado FROM tb_empleado WHERE id_usuario = $1)',
      [idObjetivo]
    );
    await client.query('DELETE FROM tb_empleado WHERE id_usuario = $1', [idObjetivo]);
    await client.query('DELETE FROM tb_cliente WHERE id_usuario = $1', [idObjetivo]);
    await client.query('DELETE FROM tb_usuarios WHERE id_usuario = $1', [idObjetivo]);
  });

  return { accion: 'eliminado', mensaje: 'Usuario eliminado correctamente' };
}

// Las consultas de listado proyectan únicamente datos de presentación.
// No seleccionar contrasena ni campos de recuperación, aunque existan en tabla.
export async function listarUsuarios() {
  const { rows } = await query(`
    SELECT u.id_usuario, u.tipo_documento, u.nombre, u.correo,
           u.telefono, u.estado, u.id_rol, COALESCE(r.nombre, 'Sin rol') AS rol,
           r.estado AS rol_estado,
           EXISTS (SELECT 1 FROM tb_cliente c WHERE c.id_usuario = u.id_usuario) AS "esCliente",
           EXISTS (SELECT 1 FROM tb_empleado e WHERE e.id_usuario = u.id_usuario) AS "esEmpleado",
           COALESCE((
             SELECT array_agg(DISTINCT rx.nombre ORDER BY rx.nombre)
             FROM tb_empleado e
             JOIN tb_contratacion_empleado ce ON ce.id_empleado = e.id_empleado AND ${contratoVigenteSql('ce')}
             JOIN tb_empleado_roles er ON er.id_contrato = ce.id_contrato
             JOIN tb_roles rx ON rx.id_rol = er.id_rol
             WHERE e.id_usuario = u.id_usuario
           ), ARRAY[]::text[]) AS "rolesExtra",
           (NULLIF(BTRIM($1), '') IS NOT NULL
             AND u.id_usuario::text = BTRIM($1)) AS "esSuperAdmin"
    FROM tb_usuarios u
    LEFT JOIN tb_roles r ON r.id_rol = u.id_rol
    ORDER BY u.nombre, u.id_usuario
  `, [superAdminId()]);
  return rows;
}

export async function listarClientes() {
  const { rows } = await query(`
    SELECT c.id_cliente, c.id_usuario, c.estado AS cliente_estado,
           u.tipo_documento, u.nombre, u.correo, u.telefono,
           u.estado AS usuario_estado, u.id_rol, r.nombre AS rol,
           r.estado AS rol_estado,
           (SELECT COUNT(*)::int
              FROM tb_venta v
             WHERE v.id_cliente = c.id_cliente
               AND v.estado <> 'Anulado') AS pedidos
    FROM tb_cliente c
    JOIN tb_usuarios u ON u.id_usuario = c.id_usuario
    JOIN tb_roles r ON r.id_rol = u.id_rol
    ORDER BY u.nombre, c.id_cliente
  `, []);
  return rows;
}

export async function buscarClientePorDocumento(numero, tipoDocumento) {
  const { rows } = await query(`
    SELECT id_usuario AS documento,
           tipo_documento AS "tipoDocumento",
           nombre,
           telefono,
           estado
    FROM tb_usuarios
    WHERE id_usuario = $1
    LIMIT 1
  `, [String(numero)]);
  return rows[0] ?? null;
}

export async function buscarClientesPorNombre(termino) {
  const nombre = String(termino ?? '').trim();
  if ([...nombre].length < 3) return [];
  const { rows } = await query(`
    SELECT u.id_usuario AS documento,
           u.tipo_documento AS "tipoDocumento",
           u.nombre,
           (COALESCE(c.estado, FALSE) AND COALESCE(u.estado, FALSE)) AS estado
      FROM tb_cliente c
      JOIN tb_usuarios u ON u.id_usuario = c.id_usuario
     WHERE strpos(
       translate(lower(u.nombre), 'áéíóúüñ', 'aeiouun'),
       translate(lower($1), 'áéíóúüñ', 'aeiouun')
     ) > 0
     ORDER BY u.nombre ASC
     LIMIT 8
  `, [nombre]);
  return rows;
}

function mapearErrorCliente(error) {
  if (error.code === '23505') {
    if (error.constraint === 'tb_usuarios_correo_key') return new AppError('Este correo ya está registrado.', 409);
    if (error.constraint === 'tb_usuarios_pkey' || error.constraint === 'tb_cliente_id_usuario_key') return new AppError('Este documento ya está registrado.', 409);
    return new AppError('El cliente ya está registrado.', 409);
  }
  return error;
}

export async function crearCliente(datos) {
  const { rows: documentoExistente } = await query('SELECT 1 FROM tb_usuarios WHERE id_usuario = $1', [datos.numeroDocumento]);
  if (documentoExistente.length) throw new AppError('Este documento ya está registrado.', 409);
  const { rows: correoExistente } = await query('SELECT 1 FROM tb_usuarios WHERE LOWER(correo) = LOWER($1)', [datos.correo]);
  if (correoExistente.length) throw new AppError('Este correo ya está registrado.', 409);
  const contrasenaTemporal = randomBytes(48).toString('base64url');
  const hash = await bcrypt.hash(contrasenaTemporal, 10);
  try {
    await transaction(async (client) => {
      const { rows: roles } = await client.query("SELECT id_rol FROM tb_roles WHERE nombre = 'Cliente'");
      if (!roles[0]) throw new AppError('No existe el rol Cliente.', 500);
      await client.query(
        `INSERT INTO tb_usuarios (id_usuario, tipo_documento, nombre, correo, contrasena, telefono, id_rol, estado)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [datos.numeroDocumento, datos.tipoDocumento, normalizarNombre(datos.nombre), datos.correo, hash, datos.telefono, roles[0].id_rol, datos.estado !== false]
      );
      await client.query('INSERT INTO tb_cliente (id_usuario, estado) VALUES ($1, $2)', [datos.numeroDocumento, datos.estado !== false]);
    });
  } catch (error) {
    throw mapearErrorCliente(error);
  }
  void enviarCorreoBienvenida({ ...datos, creadoPorAdmin: true });
  return { mensaje: 'Cliente creado correctamente.' };
}

export async function editarCliente(id, datos) {
  try {
    const { rows: correoExistente } = await query(
      'SELECT 1 FROM tb_usuarios WHERE LOWER(correo) = LOWER($1) AND id_usuario <> $2',
      [datos.correo, String(id)]
    );
    if (correoExistente.length) throw new AppError('Este correo ya está registrado en otra cuenta.', 409);
    const { rowCount } = await query(
      `UPDATE tb_usuarios u SET nombre = $1, correo = $2, telefono = $3
       WHERE u.id_usuario = $4 AND EXISTS (SELECT 1 FROM tb_cliente c WHERE c.id_usuario = u.id_usuario)`,
      [normalizarNombre(datos.nombre), datos.correo, datos.telefono, String(id)]
    );
    if (!rowCount) throw new AppError('Cliente no encontrado.', 404);
  } catch (error) {
    if (error.code === '23505' && error.constraint === 'tb_usuarios_correo_key') {
      throw new AppError('Este correo ya está registrado en otra cuenta.', 409);
    }
    throw mapearErrorCliente(error);
  }
  return { mensaje: 'Cliente actualizado correctamente.' };
}

export async function cambiarEstadoUsuario(id, estado, idSolicitante) {
  const idObjetivo = String(id);
  if (estado === false && idObjetivo === String(idSolicitante)) {
    throw new AppError('No puedes desactivar tu propia cuenta.', 403);
  }
  const { rows } = await query(CONSULTA_USUARIO, [idObjetivo]);
  const objetivo = rows[0];
  if (!objetivo) throw new AppError('Usuario no encontrado.', 404);
  if (estado === false && esSuperAdminId(idObjetivo)) {
    throw new AppError('No se puede desactivar al super administrador.', 403);
  }
  if (estado === false && objetivo.estado) await protegerUltimoAdministrador(idObjetivo);
  await query(
    `UPDATE tb_usuarios
        SET estado = $1,
            token_version = token_version + CASE WHEN $1 = FALSE THEN 1 ELSE 0 END
      WHERE id_usuario = $2`,
    [estado, idObjetivo]
  );
  return { mensaje: 'Estado del usuario actualizado correctamente.' };
}

export async function cambiarEstadoCliente(id, estado, idSolicitante) {
  const idObjetivo = String(id);
  if (estado === false && idObjetivo === String(idSolicitante)) {
    throw new AppError('No puedes desactivar tu propia cuenta.', 403);
  }
  const { rows } = await query(
    `SELECT u.correo, EXISTS (SELECT 1 FROM tb_empleado e WHERE e.id_usuario = u.id_usuario) AS es_empleado
     FROM tb_usuarios u JOIN tb_cliente c ON c.id_usuario = u.id_usuario WHERE u.id_usuario = $1`,
    [idObjetivo]
  );
  if (!rows[0]) throw new AppError('Cliente no encontrado.', 404);
  if (estado === false && esSuperAdminId(idObjetivo)) {
    throw new AppError('No se puede desactivar la cuenta de Gloria.', 403);
  }
  await transaction(async (client) => {
    await client.query('UPDATE tb_cliente SET estado = $1 WHERE id_usuario = $2', [estado, idObjetivo]);
    if (!rows[0].es_empleado) {
      await client.query(
        `UPDATE tb_usuarios
            SET estado = $1,
                token_version = token_version + CASE WHEN $1 = FALSE THEN 1 ELSE 0 END
          WHERE id_usuario = $2`,
        [estado, idObjetivo]
      );
    } else if (estado === false) {
      await client.query(
        'UPDATE tb_usuarios SET token_version = token_version + 1 WHERE id_usuario = $1',
        [idObjetivo]
      );
    }
  });
  return { mensaje: 'Estado del cliente actualizado correctamente.' };
}
