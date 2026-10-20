import AppError from '../errors/AppError.js';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { query, transaction } from '../config/db.js';
import { obtenerPermisos } from './auth.service.js';
import { enviarCorreoBienvenida } from './mail.service.js';

// La cuenta de super administradora no se puede eliminar desde ningún flujo
// (misma doble condición que usa el panel: id de la semilla + correo Gloria).
const SUPER_ADMIN_ID = '12345678';
const SUPER_ADMIN_CORREO = 'gloria@lasirena.com';

const CONSULTA_USUARIO = `
  SELECT id_usuario, nombre, correo, estado, id_rol
  FROM tb_usuarios
  WHERE id_usuario = $1
`;

const CONSULTA_ACTIVOS = `
  SELECT id_usuario, id_rol
  FROM tb_usuarios
  WHERE estado = TRUE
`;

const CONSULTA_PERMISOS_ACTIVOS = `
  SELECT modulo, nombre
  FROM tb_permisos
  WHERE estado = TRUE
`;

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

// Espejo de fullAccesos() del frontend (GestionConfigScreen): para cada
// permiso activo, todas las acciones del CRUD; Dashboard solo admite "Ver";
// el privilegio "Descargar Excel" solo existe en los 6 sub-módulos que lo
// admiten. Con eso se replica en el backend la regla de "todos los permisos"
// que el panel usa para proteger al último usuario total.
const SUBS_CON_EXCEL = new Set([
  'Compras|Orden de Compra',
  'Compras|Compra',
  'Producción|Productos',
  'Producción|Orden de Producción',
  'Producción|Producto No Conforme',
  'Ventas|Ventas',
]);
const ACCIONES_CRUD = ['Ver', 'Crear', 'Editar', 'Eliminar'];
const ACCION_EXCEL = 'Descargar Excel';

function catalogoTotal(permisosActivos) {
  const esperado = new Map();
  for (const p of permisosActivos) {
    const clave = `${p.modulo}|${p.nombre}`;
    const acciones = p.modulo === 'Dashboard' ? ['Ver'] : [...ACCIONES_CRUD];
    if (SUBS_CON_EXCEL.has(clave)) acciones.push(ACCION_EXCEL);
    esperado.set(clave, acciones);
  }
  return esperado;
}

function esTotal(permisos, esperado) {
  const delUsuario = new Map(
    permisos.map((p) => [`${p.modulo}|${p.nombre}`, p.privilegios])
  );
  for (const [clave, acciones] of esperado) {
    const mios = delUsuario.get(clave) ?? [];
    if (!acciones.every((a) => mios.includes(a))) return false;
  }
  return true;
}

// Elimina la cuenta del panel (y sus fichas de cliente/empleado) o la
// desactiva si tiene ventas o contrataciones asociadas, sin romper la
// integridad referencial. Nunca borra al super administrador, la propia
// cuenta del solicitante, ni deja al sistema sin un usuario ACTIVO con
// todos los permisos.
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

  const correo = (objetivo.correo ?? '').toLowerCase();
  if (idObjetivo === SUPER_ADMIN_ID || correo === SUPER_ADMIN_CORREO) {
    throw new AppError('La cuenta de super administrador no se puede eliminar.', 403);
  }

  // La regla del último total aplica solo si el objetivo está activo (si ya
  // estaba inactivo, eliminarlo o desactivarlo no cambia el conjunto de
  // usuarios activos con todos los permisos).
  if (objetivo.estado) {
    const [permisosActivos, activos] = await Promise.all([
      query(CONSULTA_PERMISOS_ACTIVOS, []),
      query(CONSULTA_ACTIVOS, []),
    ]);
    const esperado = catalogoTotal(permisosActivos.rows);
    const mios = await obtenerPermisos(objetivo.id_rol, idObjetivo);
    if (esTotal(mios, esperado)) {
      let hayOtroTotal = false;
      for (const activo of activos.rows) {
        if (activo.id_usuario === idObjetivo) continue;
        const permisos = await obtenerPermisos(activo.id_rol, activo.id_usuario);
        if (esTotal(permisos, esperado)) {
          hayOtroTotal = true;
          break;
        }
      }
      if (!hayOtroTotal) {
        throw new AppError(
          'No se puede: el sistema debe tener al menos un usuario activo con todos los permisos.',
          409
        );
      }
    }
  }

  const { rows: asociados } = await query(CONSULTA_ASOCIADOS, [idObjetivo]);
  const ventas = Number(asociados[0].ventas);
  const contrataciones = Number(asociados[0].contrataciones);

  if (ventas > 0 || contrataciones > 0) {
    // Con historial de ventas o contrataciones la cuenta no se borra: se
    // desactiva (usuarios + fichas), conservando las filas referenciadas.
    await transaction(async (client) => {
      await client.query(
        'UPDATE tb_usuarios SET estado = FALSE WHERE id_usuario = $1',
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
           u.telefono, u.estado, u.id_rol, r.nombre AS rol,
           r.estado AS rol_estado,
           EXISTS (SELECT 1 FROM tb_empleado e WHERE e.id_usuario = u.id_usuario) AS es_empleado
    FROM tb_usuarios u
    JOIN tb_roles r ON r.id_rol = u.id_rol
    ORDER BY u.nombre, u.id_usuario
  `, []);
  return rows;
}

export async function listarClientes() {
  const { rows } = await query(`
    SELECT c.id_cliente, c.id_usuario, c.estado AS cliente_estado,
           u.tipo_documento, u.nombre, u.correo, u.telefono,
           u.estado AS usuario_estado, u.id_rol, r.nombre AS rol,
           r.estado AS rol_estado
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
      AND ($2::text IS NULL OR tipo_documento = $2)
    LIMIT 1
  `, [String(numero), tipoDocumento || null]);
  return rows[0] ?? null;
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
        [datos.numeroDocumento, datos.tipoDocumento, datos.nombre, datos.correo, hash, datos.telefono, roles[0].id_rol, datos.estado !== false]
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
      [datos.nombre, datos.correo, datos.telefono, String(id)]
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
  if (estado === false && (idObjetivo === SUPER_ADMIN_ID || String(rows[0].correo).toLowerCase() === SUPER_ADMIN_CORREO)) {
    throw new AppError('No se puede desactivar la cuenta de Gloria.', 403);
  }
  await transaction(async (client) => {
    await client.query('UPDATE tb_cliente SET estado = $1 WHERE id_usuario = $2', [estado, idObjetivo]);
    if (!rows[0].es_empleado) {
      await client.query('UPDATE tb_usuarios SET estado = $1 WHERE id_usuario = $2', [estado, idObjetivo]);
    }
  });
  return { mensaje: 'Estado del cliente actualizado correctamente.' };
}
