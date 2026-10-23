import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import AppError from '../errors/AppError.js';
import { query, transaction } from '../config/db.js';
import {
  generarTokenVerificacion,
  HORAS_VIGENCIA_VERIFICACION,
} from './verificacion.service.js';

const CREDENCIALES_INVALIDAS = 'Correo o contraseña incorrectos.';
const CUENTA_NO_ACTIVADA = 'Tu cuenta aún no está activada. Revisa tu correo.';
const SIN_BASE_DE_DATOS = 'No se pudo conectar con la base de datos.';
const DOCUMENTO_DUPLICADO = 'Este documento ya está registrado.';
const CORREO_DUPLICADO = 'Este correo ya está registrado.';
const REGISTRO_DUPLICADO = 'Este registro ya existe.';
const ERROR_INTERNO = 'Error interno del servidor.';
const normalizarNombre = (valor) => {
  const lower = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e']);
  return String(valor ?? '').trim().toLocaleLowerCase('es').split(/\s+/).filter(Boolean)
    .map((p, i) => i && lower.has(p) ? p : p.charAt(0).toLocaleUpperCase('es') + p.slice(1)).join(' ');
};

const CONSULTA_LOGIN = `
  SELECT u.id_usuario, u.tipo_documento, u.nombre, u.correo, u.telefono,
         u.contrasena, u.estado, u.id_rol, u.token_activacion,
         r.nombre AS rol, r.estado AS rol_estado
  FROM tb_usuarios u
  JOIN tb_roles r ON r.id_rol = u.id_rol
  WHERE LOWER(u.correo) = LOWER($1) AND u.correo IS NOT NULL
`;

const CONSULTA_POR_ID = `
  SELECT u.id_usuario, u.tipo_documento, u.nombre, u.correo, u.telefono,
         u.estado, u.id_rol,
         r.nombre AS rol, r.estado AS rol_estado
  FROM tb_usuarios u
  JOIN tb_roles r ON r.id_rol = u.id_rol
  WHERE u.id_usuario = $1
`;

const PERMISOS_ROL_BASE = `
  SELECT p.modulo, p.nombre AS permiso, pr.nombre AS privilegio
  FROM tb_roles_permiso rp
  JOIN tb_permisos p ON p.id_permiso = rp.id_permiso AND p.estado = TRUE
  JOIN tb_privilegio pr ON pr.id_privilegio = rp.id_privilegio
  WHERE rp.id_rol = $1
`;

const PERMISOS_ROLES_EXTRA = `
  SELECT p.modulo, p.nombre AS permiso, pr.nombre AS privilegio
  FROM tb_empleado e
  JOIN tb_contratacion_empleado ce ON ce.id_empleado = e.id_empleado AND ce.fecha_final IS NULL
  JOIN tb_empleado_roles er ON er.id_contrato = ce.id_contrato
  JOIN tb_roles r ON r.id_rol = er.id_rol AND r.estado = TRUE
  JOIN tb_roles_permiso rp ON rp.id_rol = er.id_rol
  JOIN tb_permisos p ON p.id_permiso = rp.id_permiso AND p.estado = TRUE
  JOIN tb_privilegio pr ON pr.id_privilegio = rp.id_privilegio
  WHERE e.id_usuario = $1 AND e.estado = TRUE
`;

async function consultar(sql, params) {
  try {
    return await query(sql, params);
  } catch (error) {
    console.error('Error de base de datos:', error.code);
    throw new AppError(SIN_BASE_DE_DATOS, 503);
  }
}

export async function obtenerPermisos(idRol, idUsuario) {
  const [base, extra] = await Promise.all([
    consultar(PERMISOS_ROL_BASE, [idRol]),
    consultar(PERMISOS_ROLES_EXTRA, [idUsuario]),
  ]);

  const permisos = new Map();

  for (const fila of [...base.rows, ...extra.rows]) {
    const clave = `${fila.modulo}|${fila.permiso}`;
    if (!permisos.has(clave)) {
      permisos.set(clave, {
        modulo: fila.modulo,
        nombre: fila.permiso,
        privilegios: [],
      });
    }
    const permiso = permisos.get(clave);
    if (!permiso.privilegios.includes(fila.privilegio)) {
      permiso.privilegios.push(fila.privilegio);
    }
  }

  return [...permisos.values()];
}

export async function obtenerPermisosDeRol(idRol) {
  const { rows } = await consultar(PERMISOS_ROL_BASE, [idRol]);
  const permisos = new Map();
  for (const fila of rows) {
    const clave = `${fila.modulo}|${fila.permiso}`;
    if (!permisos.has(clave)) {
      permisos.set(clave, { modulo: fila.modulo, nombre: fila.permiso, privilegios: [] });
    }
    const permiso = permisos.get(clave);
    if (!permiso.privilegios.includes(fila.privilegio)) permiso.privilegios.push(fila.privilegio);
  }
  return [...permisos.values()];
}

async function obtenerRolesAsignados(idRol, idUsuario) {
  const { rows: extras } = await consultar(`
    SELECT DISTINCT r.id_rol, r.nombre
    FROM tb_empleado e
    JOIN tb_contratacion_empleado ce ON ce.id_empleado = e.id_empleado AND ce.fecha_final IS NULL
    JOIN tb_empleado_roles er ON er.id_contrato = ce.id_contrato
    JOIN tb_roles r ON r.id_rol = er.id_rol AND r.estado = TRUE
    WHERE e.id_usuario = $1 AND e.estado = TRUE
    ORDER BY r.id_rol
  `, [idUsuario]);
  const { rows: principal } = await consultar(
    'SELECT id_rol, nombre FROM tb_roles WHERE id_rol = $1 AND estado = TRUE',
    [idRol],
  );
  const roles = new Map();
  if (principal[0]) roles.set(String(principal[0].id_rol), principal[0]);
  for (const rol of extras) roles.set(String(rol.id_rol), rol);
  return Promise.all([...roles.values()].map(async rol => ({
    id: rol.id_rol,
    nombre: rol.nombre,
    permisos: await obtenerPermisosDeRol(rol.id_rol),
  })));
}

function armarUsuario(datos, permisos, roles) {
  const superAdminId = String(process.env.SUPER_ADMIN_ID || '').trim();
  return {
    id: datos.id_usuario,
    nombre: datos.nombre,
    correo: datos.correo,
    // El número de documento ES el id de usuario (así lo crea el registro).
    numeroDocumento: String(datos.id_usuario),
    tipoDocumento: datos.tipo_documento ?? '',
    telefono: datos.telefono ?? '',
    rol: datos.rol,
    esSuperAdmin: Boolean(superAdminId) && String(datos.id_usuario) === superAdminId,
    permisos,
    roles,
  };
}

export async function login(correo, contrasena) {
  const { rows } = await consultar(CONSULTA_LOGIN, [correo]);
  const usuario = rows[0];

  if (!usuario) {
    throw new AppError(CREDENCIALES_INVALIDAS, 401);
  }

  // Invitación pendiente: la cuenta existe pero su contraseña todavía no está
  // creada; el empleado debe activarla desde el correo.
  if (usuario.token_activacion) {
    throw new AppError(CUENTA_NO_ACTIVADA, 403);
  }

  if (!usuario.estado || !usuario.rol_estado || !usuario.contrasena) {
    throw new AppError(CREDENCIALES_INVALIDAS, 401);
  }

  let coincide = false;
  try {
    coincide = await bcrypt.compare(contrasena, usuario.contrasena);
  } catch (error) {
    coincide = false;
  }

  if (!coincide) {
    throw new AppError(CREDENCIALES_INVALIDAS, 401);
  }

  const permisos = await obtenerPermisos(usuario.id_rol, usuario.id_usuario);
  const roles = await obtenerRolesAsignados(usuario.id_rol, usuario.id_usuario);

  const token = jwt.sign(
    { sub: usuario.id_usuario, rol: usuario.rol },
    process.env.JWT_SECRET,
    {
      algorithm: 'HS256',
      expiresIn: process.env.JWT_EXPIRES_IN || '8h',
    }
  );

  return {
    token,
    usuario: await armarUsuario(usuario, permisos, roles),
  };
}

export async function obtenerUsuarioPorId(idUsuario) {
  const { rows } = await consultar(CONSULTA_POR_ID, [idUsuario]);
  const usuario = rows[0];

  if (!usuario || !usuario.estado || !usuario.rol_estado) {
    throw new AppError('No autorizado.', 401);
  }

  const permisos = await obtenerPermisos(usuario.id_rol, usuario.id_usuario);
  const roles = await obtenerRolesAsignados(usuario.id_rol, usuario.id_usuario);
  return armarUsuario(usuario, permisos, roles);
}

const CONSULTA_CORREO_DE_OTRO = `
  SELECT 1 FROM tb_usuarios WHERE LOWER(correo) = LOWER($1) AND id_usuario <> $2
`;

const UPDATE_PERFIL = `
  UPDATE tb_usuarios SET correo = $1, telefono = $2 WHERE id_usuario = $3
`;

/**
 * Actualiza SOLO correo y teléfono del usuario autenticado (los demás campos
 * del body se ignoran en el validador). tb_cliente y tb_empleado no copian
 * estos campos (verificado en information_schema), así que basta un solo
 * UPDATE sobre tb_usuarios. Devuelve el perfil completo igual que /auth/me.
 */
export async function actualizarPerfilUsuario(idUsuario, correo, telefono) {
  const propio = await consultar(CONSULTA_CORREO_DE_OTRO, [correo, idUsuario]);
  if (propio.rows.length > 0) {
    throw new AppError(CORREO_DUPLICADO, 409);
  }

  try {
    await consultar(UPDATE_PERFIL, [correo, telefono, idUsuario]);
  } catch (error) {
    throw mapearErrorDeBase(error);
  }

  return obtenerUsuarioPorId(idUsuario);
}

const CONSULTA_DOCUMENTO_EXISTE = `
  SELECT 1 FROM tb_usuarios WHERE id_usuario = $1
`;

const CONSULTA_CORREO_EXISTE = `
  SELECT 1 FROM tb_usuarios WHERE LOWER(correo) = LOWER($1)
`;


const CONSULTA_ROL_CLIENTE = `
  SELECT id_rol FROM tb_roles WHERE nombre = 'Cliente'
`;

// La cuenta nace PENDIENTE de verificar el correo: hash del token y su
// vencimiento en las columnas de activación (el login la bloquea mientras
// token_activacion exista).
const INSERT_USUARIO = `
  INSERT INTO tb_usuarios (id_usuario, tipo_documento, nombre, correo, contrasena, telefono, id_rol,
                           token_activacion, token_activacion_expira)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW() + ($9::int * INTERVAL '1 hour'))
`;

const INSERT_CLIENTE = `
  INSERT INTO tb_cliente (id_usuario) VALUES ($1)
`;

function mapearErrorDeBase(error) {
  if (error instanceof AppError) {
    return error;
  }

  if (error.code === '23505') {
    console.error('Error de base de datos:', error.code, error.constraint);

    if (error.constraint === 'tb_usuarios_correo_key') {
      return new AppError(CORREO_DUPLICADO, 409);
    }

    if (
      error.constraint === 'tb_usuarios_pkey' ||
      error.constraint === 'tb_cliente_id_usuario_key'
    ) {
      return new AppError(DOCUMENTO_DUPLICADO, 409);
    }

    return new AppError(REGISTRO_DUPLICADO, 409);
  }

  console.error('Error de base de datos:', error.code);
  return new AppError(SIN_BASE_DE_DATOS, 503);
}

export async function registrarCliente(datos) {
  const { tipoDocumento, numeroDocumento, nombre, correo, telefono, contrasena } =
    datos;

  const documento = await consultar(CONSULTA_DOCUMENTO_EXISTE, [numeroDocumento]);
  if (documento.rows.length > 0) {
    throw new AppError(DOCUMENTO_DUPLICADO, 409);
  }

  const duplicado = await consultar(CONSULTA_CORREO_EXISTE, [correo]);
  if (duplicado.rows.length > 0) {
    throw new AppError(CORREO_DUPLICADO, 409);
  }

  const rol = await consultar(CONSULTA_ROL_CLIENTE, []);
  const rolCliente = rol.rows[0];
  if (!rolCliente) {
    console.log('Falta el rol Cliente en tb_roles');
    throw new AppError(ERROR_INTERNO, 500);
  }

  const hash = await bcrypt.hash(contrasena, 10);
  const verificacion = generarTokenVerificacion();

  try {
    await transaction(async (client) => {
      await client.query(INSERT_USUARIO, [
        numeroDocumento,
        tipoDocumento,
        normalizarNombre(nombre),
        correo,
        hash,
        telefono,
        rolCliente.id_rol,
        verificacion.hash,
        HORAS_VIGENCIA_VERIFICACION,
      ]);
      await client.query(INSERT_CLIENTE, [numeroDocumento]);
    });
  } catch (error) {
    throw mapearErrorDeBase(error);
  }

  // `verificacion` (token en claro) es solo para el correo: el controlador
  // nunca lo incluye en la respuesta HTTP.
  return {
    usuario: {
      id: numeroDocumento,
      nombre: normalizarNombre(nombre),
      correo,
      rol: 'Cliente',
    },
    verificacion: { token: verificacion.token, vencimiento: verificacion.vencimiento },
  };
}
