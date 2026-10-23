import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import AppError from '../errors/AppError.js';
import { query, transaction } from '../config/db.js';
import { enviarAvisoIngresoEquipo, enviarInvitacionEmpleado } from './mail.service.js';

// Alta de empleado con invitación por correo. El formulario NO pide contraseña:
// la cuenta se crea con el hash de un valor aleatorio que nadie conoce (así se
// cumple el CHECK de "correo y contraseña juntos") y el empleado la define al
// activarse con el enlace ?activar=<token>.
//
// Reglas del negocio:
//  - La identidad la define el DOCUMENTO. Si el correo pertenece a otra cuenta
//    se responde 409 (nunca se fusionan dos personas por un correo compartido).
//  - Todo empleado tiene SIEMPRE los roles Empleado y Cliente, más sus cargos,
//    y por eso también recibe su fila en tb_cliente.
//  - El rol Administrador nunca se asigna a un empleado.
const HORAS_VIGENCIA_TOKEN = 72;

const MENSAJE_CORREO_DE_OTRO = 'Este correo ya está registrado en otra cuenta.';
const MENSAJE_EMPLEADO_EXISTENTE = 'Este documento ya está registrado como empleado.';
const MENSAJE_ROL_ADMINISTRADOR = 'El rol Administrador no se asigna a un empleado.';
const MENSAJE_SIN_ROLES_BASE = 'No existen los roles base Empleado y Cliente en el sistema.';

const normalizar = (valor) => String(valor ?? '').trim().toLocaleLowerCase('es');

const normalizarNombre = (valor) => {
  const minusculas = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e']);
  return String(valor ?? '').trim().toLocaleLowerCase('es').split(/\s+/).filter(Boolean)
    .map((palabra, indice) => indice > 0 && minusculas.has(palabra)
      ? palabra
      : palabra.charAt(0).toLocaleUpperCase('es') + palabra.slice(1)).join(' ');
};

/** Token de activación de un solo uso: al correo va en claro y en la base solo
 *  se guarda su hash SHA-256. */
function generarTokenActivacion() {
  const token = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, hash };
}

const vencimientoDeToken = () =>
  new Date(Date.now() + HORAS_VIGENCIA_TOKEN * 60 * 60 * 1000);

/** Roles base que TODO empleado lleva (Empleado es su rol de cuenta, Cliente
 *  viaja en tb_empleado_roles junto con los cargos). */
async function resolverRolesBase() {
  const { rows } = await query(
    `SELECT id_rol, LOWER(TRIM(nombre)) AS nombre
       FROM tb_roles
      WHERE LOWER(TRIM(nombre)) IN ('empleado', 'cliente')`,
    []
  );
  const porNombre = new Map(rows.map((fila) => [fila.nombre, fila.id_rol]));
  const rolEmpleado = porNombre.get('empleado');
  const rolCliente = porNombre.get('cliente');
  if (rolEmpleado === undefined || rolCliente === undefined) {
    throw new AppError(MENSAJE_SIN_ROLES_BASE, 500);
  }
  return { rolEmpleado, rolCliente };
}

/** Cargos del formulario → ids de tb_roles (se resuelven por NOMBRE, porque los
 *  ids locales del panel no son los ids de la base). Empleado y Cliente no se
 *  repiten; Administrador está prohibido. */
async function resolverCargos(cargos) {
  const nombres = [...new Set((cargos ?? []).map((cargo) => String(cargo).trim()).filter(Boolean))];
  for (const nombre of nombres) {
    if (normalizar(nombre) === 'administrador') {
      throw new AppError(MENSAJE_ROL_ADMINISTRADOR, 400);
    }
  }
  const pendientes = nombres.filter((nombre) => !['empleado', 'cliente'].includes(normalizar(nombre)));
  if (pendientes.length === 0) return [];

  const { rows } = await query(
    `SELECT id_rol, LOWER(TRIM(nombre)) AS nombre
       FROM tb_roles
      WHERE LOWER(TRIM(nombre)) = ANY($1)`,
    [pendientes.map(normalizar)]
  );
  const porNombre = new Map(rows.map((fila) => [fila.nombre, fila.id_rol]));
  return pendientes.map((nombre) => {
    const idRol = porNombre.get(normalizar(nombre));
    if (idRol === undefined) {
      throw new AppError(`El rol "${nombre}" no existe en el sistema.`, 400);
    }
    return idRol;
  });
}

/** Roles visibles para el correo: Empleado y Cliente siempre, más los cargos
 *  extra en el orden en que los eligió el administrador. */
function rolesVisibles(cargos) {
  const extras = (cargos ?? []).filter((cargo) => !['empleado', 'cliente'].includes(normalizar(cargo)));
  return [...new Set(['Empleado', 'Cliente', ...extras])];
}

/** Contratación vigente del empleado (para el correo de reenvío). */
async function datosDeContratacion(documento) {
  const { rows } = await query(
    `SELECT to_char(ce.fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio,
            COALESCE(array_agg(DISTINCT r.nombre) FILTER (WHERE r.nombre IS NOT NULL), ARRAY[]::text[]) AS roles
       FROM tb_empleado e
       JOIN tb_contratacion_empleado ce ON ce.id_empleado = e.id_empleado AND ce.fecha_final IS NULL
       LEFT JOIN tb_empleado_roles er ON er.id_contrato = ce.id_contrato
       LEFT JOIN tb_roles r ON r.id_rol = er.id_rol
      WHERE e.id_usuario = $1
      GROUP BY ce.fecha_inicio`,
    [documento]
  );
  const fila = rows[0];
  const extras = (fila?.roles ?? [])
    .filter((nombre) => !['empleado', 'cliente', 'administrador'].includes(normalizar(nombre)));
  return {
    roles: [...new Set(['Empleado', 'Cliente', ...extras])],
    fechaInicio: fila?.fecha_inicio ?? '',
  };
}

/**
 * POST /empleados: crea la cuenta (o la completa) y la ficha de empleado con su
 * contratación, y envía el correo que corresponde:
 *  - Persona nueva o cuenta sin contraseña → INVITACIÓN (crea su contraseña).
 *  - Cuenta con contraseña (cliente registrado) → aviso "ya eres parte del
 *    equipo" (conserva su contraseña).
 * El correo se manda esperando el resultado para poder avisar al panel si falla:
 * el empleado se crea igual, con o sin correo.
 */
export async function crearEmpleado(datos) {
  const documento = String(datos.numeroDocumento).trim();
  const correo = datos.correo;

  const { rolEmpleado, rolCliente } = await resolverRolesBase();
  const idsCargos = await resolverCargos(datos.cargos ?? []);

  // El correo puede ser de ESTA persona (o estar libre), nunca de otra cuenta.
  const { rows: duenosCorreo } = await query(
    'SELECT id_usuario FROM tb_usuarios WHERE LOWER(correo) = LOWER($1)',
    [correo]
  );
  if (duenosCorreo.some((fila) => String(fila.id_usuario) !== documento)) {
    throw new AppError(MENSAJE_CORREO_DE_OTRO, 409);
  }

  const { rows: cuentas } = await query(
    'SELECT id_usuario, contrasena FROM tb_usuarios WHERE id_usuario = $1',
    [documento]
  );
  const existente = cuentas[0];
  if (existente) {
    const { rows: yaEmpleado } = await query(
      'SELECT 1 FROM tb_empleado WHERE id_usuario = $1',
      [documento]
    );
    if (yaEmpleado.length) throw new AppError(MENSAJE_EMPLEADO_EXISTENTE, 409);
  }

  // Caso especial: ya tiene contraseña → NO se crea usuario ni se pide otra.
  const cuentaConContrasena = Boolean(existente?.contrasena);
  const { token, hash: hashToken } = generarTokenActivacion();
  const contrasenaTemporal = crypto.randomBytes(48).toString('base64url');
  const hashContrasena = await bcrypt.hash(contrasenaTemporal, 10);
  const nombreNormalizado = normalizarNombre(datos.nombre);

  await transaction(async (client) => {
    if (!existente) {
      await client.query(
        `INSERT INTO tb_usuarios
           (id_usuario, tipo_documento, nombre, correo, contrasena, telefono, id_rol, estado,
            token_activacion, token_activacion_expira)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW() + ($10::int * INTERVAL '1 hour'))`,
        [documento, datos.tipoDocumento, nombreNormalizado, correo, hashContrasena,
          datos.telefono || null, rolEmpleado, datos.estado, hashToken, HORAS_VIGENCIA_TOKEN]
      );
    } else if (!cuentaConContrasena) {
      // Cuenta sin contraseña (creada desde el panel, sin correo): se le arma la
      // cuenta real con el correo del formulario y la invitación normal.
      await client.query(
        `UPDATE tb_usuarios
            SET correo = $1, contrasena = $2, id_rol = $3, estado = $4,
                token_activacion = $5,
                token_activacion_expira = NOW() + ($6::int * INTERVAL '1 hour')
          WHERE id_usuario = $7`,
        [correo, hashContrasena, rolEmpleado, datos.estado, hashToken, HORAS_VIGENCIA_TOKEN, documento]
      );
    } else {
      // Caso especial: cuenta con contraseña. Solo se asigna el rol Empleado;
      // el estado de su cuenta no se toca (sigue siendo la suya).
      await client.query(
        'UPDATE tb_usuarios SET id_rol = $1 WHERE id_usuario = $2',
        [rolEmpleado, documento]
      );
    }

    const { rows: filasEmpleado } = await client.query(
      'INSERT INTO tb_empleado (id_usuario, estado) VALUES ($1, $2) RETURNING id_empleado',
      [documento, datos.estado]
    );
    const idEmpleado = filasEmpleado[0].id_empleado;

    const { rows: filasContrato } = await client.query(
      `INSERT INTO tb_contratacion_empleado (id_empleado, fecha_inicio, fecha_final)
       VALUES ($1, $2::date, NULLIF($3, '')::date)
       RETURNING id_contrato`,
      [idEmpleado, datos.fechaInicio, datos.fechaFinal || '']
    );
    const idContrato = filasContrato[0].id_contrato;

    // Todo empleado tiene SIEMPRE Empleado (su rol de cuenta) y Cliente, más
    // los cargos elegidos.
    for (const idRol of new Set([rolCliente, ...idsCargos])) {
      await client.query(
        'INSERT INTO tb_empleado_roles (id_contrato, id_rol) VALUES ($1, $2)',
        [idContrato, idRol]
      );
    }

    // Todo empleado también es cliente (fila en tb_cliente); si ya existía se
    // conserva tal cual.
    await client.query(
      'INSERT INTO tb_cliente (id_usuario, estado) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [documento, datos.estado]
    );
  });

  const datosCorreo = {
    nombre: nombreNormalizado,
    correo,
    tipoDocumento: datos.tipoDocumento,
    numeroDocumento: documento,
    roles: rolesVisibles(datos.cargos),
    fechaInicio: datos.fechaInicio,
  };
  const correoEnviado = cuentaConContrasena
    ? await enviarAvisoIngresoEquipo(datosCorreo)
    : await enviarInvitacionEmpleado({ ...datosCorreo, token, vencimiento: vencimientoDeToken() });

  return {
    mensaje: cuentaConContrasena
      ? 'Empleado creado. Se le avisó que ya es parte del equipo.'
      : 'Empleado creado.',
    cuentaExistente: cuentaConContrasena,
    correo,
    correoEnviado,
  };
}

/**
 * POST /empleados/:id/reenviar-invitacion: genera un token NUEVO (el anterior
 * deja de servir) y vuelve a enviar el correo de invitación. Solo aplica a
 * empleados con invitación pendiente.
 */
export async function reenviarInvitacion(idUsuario) {
  const documento = String(idUsuario).trim();

  const { rows } = await query(
    `SELECT u.nombre, u.correo, u.tipo_documento,
            (u.token_activacion IS NOT NULL) AS pendiente
       FROM tb_usuarios u
      WHERE u.id_usuario = $1
        AND EXISTS (SELECT 1 FROM tb_empleado e WHERE e.id_usuario = u.id_usuario)`,
    [documento]
  );
  const usuario = rows[0];
  if (!usuario) throw new AppError('Empleado no encontrado.', 404);
  if (!usuario.pendiente) throw new AppError('Esta cuenta ya fue activada.', 409);

  const { token, hash } = generarTokenActivacion();
  await query(
    `UPDATE tb_usuarios
        SET token_activacion = $1,
            token_activacion_expira = NOW() + ($2::int * INTERVAL '1 hour')
      WHERE id_usuario = $3`,
    [hash, HORAS_VIGENCIA_TOKEN, documento]
  );

  const { roles, fechaInicio } = await datosDeContratacion(documento);
  const correoEnviado = await enviarInvitacionEmpleado({
    nombre: usuario.nombre,
    correo: usuario.correo,
    tipoDocumento: usuario.tipo_documento,
    numeroDocumento: documento,
    roles,
    fechaInicio,
    token,
    vencimiento: vencimientoDeToken(),
  });

  return {
    mensaje: 'Invitación reenviada.',
    correo: usuario.correo,
    correoEnviado,
  };
}

/** GET /empleados/invitaciones: documentos con invitación pendiente (quien no
 *  aparece aquí ya activó su cuenta o nunca la tuvo por crear). */
export async function listarInvitacionesPendientes() {
  const { rows } = await query(
    'SELECT id_usuario FROM tb_usuarios WHERE token_activacion IS NOT NULL',
    []
  );
  return { pendientes: rows.map((fila) => String(fila.id_usuario)) };
}
