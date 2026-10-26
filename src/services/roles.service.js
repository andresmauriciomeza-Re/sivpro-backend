import AppError from '../errors/AppError.js';
import { query, transaction } from '../config/db.js';
import { contratoVigenteSql } from '../utils/contratacion.js';

const PRIVILEGIOS_CRUD = ['Ver', 'Crear', 'Editar', 'Eliminar'];
const PERMISOS_EXCEL = new Set([
  'Compras::Orden de Compra',
  'Compras::Compra',
  'Producción::Productos',
  'Producción::Orden de Producción',
  'Producción::Producto No Conforme',
  'Ventas::Ventas',
]);
const CATALOGO_PANEL = [
  ['Dashboard', 'Dashboard'],
  ['Configuración', 'Roles'], ['Configuración', 'Usuarios'],
  ['Compras', 'Insumos'], ['Compras', 'Proveedores'],
  ['Compras', 'Orden de Compra'], ['Compras', 'Compra'],
  ['Producción', 'Categoría de Producto'], ['Producción', 'Productos'],
  ['Producción', 'Orden de Producción'], ['Producción', 'Empleados'],
  ['Producción', 'Producto No Conforme'],
  ['Ventas', 'Clientes'], ['Ventas', 'Ventas'], ['Ventas', 'Devoluciones'],
];
const PRIVILEGIOS_TOTALES = CATALOGO_PANEL.flatMap(([modulo, permiso]) => {
  const key = `${modulo}::${permiso}`;
  const acciones = modulo === 'Dashboard'
    ? ['Ver']
    : [...PRIVILEGIOS_CRUD, ...(PERMISOS_EXCEL.has(key) ? ['Descargar Excel'] : [])];
  return acciones.map(privilegio => `${modulo}|${permiso}|${privilegio}`);
});

const FORMAS_GENERICAS = {
  mesera: 'mesero', cajera: 'cajero', cocinera: 'cocinero',
  domiciliaria: 'domiciliario', administradora: 'administrador',
  repartidora: 'repartidor', panadera: 'panadero', pizzera: 'pizzero',
  jefa: 'jefe', supervisora: 'supervisor', encargada: 'encargado',
  empleada: 'empleado', operaria: 'operario', vendedora: 'vendedor',
  contadora: 'contador', aseadora: 'aseador', asistenta: 'asistente',
  gerenta: 'gerente', ayudanta: 'ayudante',
};

const quitarTildes = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const claveNombre = value => quitarTildes(String(value ?? ''))
  .trim().toLowerCase().split(/\s+/).filter(Boolean)
  .map(palabra => palabra.replace(/s$/, '').replace(/[aeo]$/, '')).join(' ');
const ROLES_BASE = new Set(['Administrador', 'Cliente', 'Empleado'].map(claveNombre));
const esRolBase = nombre => ROLES_BASE.has(claveNombre(nombre));
const esAdministrador = nombre => claveNombre(nombre) === claveNombre('Administrador');
const normalizarEspacios = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const formatearNombre = value => {
  const limpio = normalizarEspacios(value).toLowerCase();
  return limpio ? limpio.charAt(0).toUpperCase() + limpio.slice(1) : '';
};

function validarNombre(nombre) {
  if (typeof nombre !== 'string' || !nombre.trim()) {
    throw new AppError('El nombre del rol es obligatorio.', 400);
  }
  if (nombre !== nombre.trim() || /\s{2,}/.test(nombre) || !/^\p{L}+(?: \p{L}+)*$/u.test(nombre)) {
    throw new AppError('Usa solo letras y espacios, sin espacios dobles.', 400);
  }
  if (nombre.trim().length < 3) throw new AppError('El nombre del rol debe tener al menos 3 caracteres.', 400);

  const palabras = quitarTildes(nombre).toLowerCase().split(' ');
  for (let i = 1; i < palabras.length - 1; i += 1) {
    if (!['o', 'y'].includes(palabras[i])) continue;
    if (claveNombre(palabras[i - 1]) === claveNombre(palabras[i + 1])) {
      throw new AppError('Un solo nombre debe agrupar a todos; no uses formas dobles.', 400);
    }
  }
  return formatearNombre(nombre);
}

function validarFormaGenerica(nombre) {
  const [primera, ...resto] = quitarTildes(nombre).toLowerCase().split(' ');
  const sugerencia = FORMAS_GENERICAS[primera]
    ?? (primera.endsWith('ora') ? primera.slice(0, -1) : null);
  if (sugerencia) {
    const generico = formatearNombre([sugerencia, ...resto].join(' '));
    throw new AppError(`Usa la forma genérica del cargo: «${generico}».`, 400);
  }
}

function validarAccesos(accesos, catalogo, privilegios) {
  if (!accesos || typeof accesos !== 'object' || Array.isArray(accesos)) {
    throw new AppError('Los accesos del rol deben ser un mapa válido.', 400);
  }
  const permisosPorClave = new Map(catalogo.map(p => [`${p.modulo}::${p.nombre}`, p]));
  const resultado = [];
  for (const [clave, lista] of Object.entries(accesos)) {
    if (!permisosPorClave.has(clave)) {
      throw new AppError(`El permiso «${clave}» no existe o está inactivo.`, 400);
    }
    if (!Array.isArray(lista)) throw new AppError(`Los privilegios de «${clave}» deben ser una lista.`, 400);
    const [modulo, nombre] = clave.split('::');
    const permitidos = new Set(privilegios);
    const unicos = new Set();
    for (const privilegio of lista) {
      if (typeof privilegio !== 'string' || !permitidos.has(privilegio)) {
        throw new AppError(`El privilegio «${privilegio}» no existe.`, 400);
      }
      if (unicos.has(privilegio)) throw new AppError(`El privilegio «${privilegio}» está repetido.`, 400);
      unicos.add(privilegio);
      resultado.push({ modulo, nombre, privilegio });
    }
  }
  return resultado;
}

async function bloquearCambiosDeRoles(client) {
  await client.query(`
    LOCK TABLE tb_roles, tb_roles_permiso, tb_permisos,
      tb_usuarios, tb_empleado_roles, tb_empleado, tb_contratacion_empleado
    IN SHARE ROW EXCLUSIVE MODE
  `);
}

async function obtenerCatalogo(client = null) {
  const ejecutar = client ? client.query.bind(client) : query;
  const [permisos, privilegios] = await Promise.all([
    ejecutar(`SELECT id_permiso, modulo, nombre, descripcion
              FROM tb_permisos WHERE estado = TRUE ORDER BY modulo, nombre`, []),
    ejecutar('SELECT id_privilegio, nombre, descripcion FROM tb_privilegio ORDER BY nombre', []),
  ]);
  return {
    permisos: permisos.rows,
    privilegios: privilegios.rows,
  };
}

export async function listarPermisos() {
  const catalogo = await obtenerCatalogo();
  const porId = new Map(catalogo.permisos.map(p => [p.id_permiso, { ...p, privilegios: [] }]));
  for (const privilegio of catalogo.privilegios) {
    for (const permiso of porId.values()) permiso.privilegios.push(privilegio);
  }
  return [...porId.values()];
}

const CONSULTA_ROLES = `
  SELECT r.id_rol, r.nombre, r.descripcion, r.estado,
         COUNT(DISTINCT asignados.id_usuario)::int AS usuarios_asignados
  FROM tb_roles r
  LEFT JOIN (
    SELECT id_rol, id_usuario FROM tb_usuarios
    UNION
    SELECT er.id_rol, e.id_usuario
    FROM tb_empleado_roles er
    JOIN tb_contratacion_empleado ce ON ce.id_contrato = er.id_contrato
    JOIN tb_empleado e ON e.id_empleado = ce.id_empleado
  ) asignados ON asignados.id_rol = r.id_rol
  GROUP BY r.id_rol, r.nombre, r.descripcion, r.estado
  ORDER BY r.id_rol
`;

async function listarRolesCon(client = null) {
  const ejecutar = client ? client.query.bind(client) : query;
  const [roles, relaciones] = await Promise.all([
    ejecutar(CONSULTA_ROLES, []),
    ejecutar(`SELECT rp.id_rol, p.modulo, p.nombre AS permiso, pr.nombre AS privilegio
              FROM tb_roles_permiso rp
              JOIN tb_permisos p ON p.id_permiso = rp.id_permiso
              JOIN tb_privilegio pr ON pr.id_privilegio = rp.id_privilegio
              ORDER BY rp.id_rol, p.modulo, p.nombre, pr.nombre`, []),
  ]);
  const porId = new Map(roles.rows.map(rol => [String(rol.id_rol), {
    id: String(rol.id_rol), nombre: rol.nombre, descripcion: rol.descripcion ?? '',
    activo: rol.estado, usuariosAsignados: Number(rol.usuarios_asignados), accesos: {},
  }]));
  for (const fila of relaciones.rows) {
    const rol = porId.get(String(fila.id_rol));
    if (!rol) continue;
    const key = `${fila.modulo}::${fila.permiso}`;
    (rol.accesos[key] ??= []).push(fila.privilegio);
  }
  return [...porId.values()];
}

export async function listarRoles() {
  return listarRolesCon();
}

async function contarUsuariosConAccesoTotal(client) {
  const { rows } = await client.query(`
    WITH asignaciones AS (
      SELECT u.id_usuario, u.id_rol
      FROM tb_usuarios u JOIN tb_roles r ON r.id_rol = u.id_rol AND r.estado = TRUE
      WHERE u.estado = TRUE
      UNION
      SELECT u.id_usuario, er.id_rol
      FROM tb_usuarios u
      JOIN tb_empleado e ON e.id_usuario = u.id_usuario AND e.estado = TRUE
      JOIN tb_contratacion_empleado ce ON ce.id_empleado = e.id_empleado AND ${contratoVigenteSql('ce')}
      JOIN tb_empleado_roles er ON er.id_contrato = ce.id_contrato
      JOIN tb_roles r ON r.id_rol = er.id_rol AND r.estado = TRUE
      WHERE u.estado = TRUE
    ),
    permisos_efectivos AS (
      SELECT DISTINCT a.id_usuario, p.modulo, p.nombre AS permiso, pr.nombre AS privilegio
      FROM asignaciones a
      JOIN tb_roles_permiso rp ON rp.id_rol = a.id_rol
      JOIN tb_permisos p ON p.id_permiso = rp.id_permiso AND p.estado = TRUE
      JOIN tb_privilegio pr ON pr.id_privilegio = rp.id_privilegio
    )
    SELECT COUNT(DISTINCT id_usuario)::int AS cantidad
    FROM permisos_efectivos
    WHERE (modulo || '|' || permiso || '|' || privilegio) = ANY($1::text[])
    GROUP BY id_usuario
    HAVING COUNT(DISTINCT modulo || '|' || permiso || '|' || privilegio) = $2
  `, [PRIVILEGIOS_TOTALES, PRIVILEGIOS_TOTALES.length]);
  return rows.length;
}

async function asegurarNoEliminarUltimoAccesoTotal(client, totalAntes) {
  if (totalAntes > 0 && await contarUsuariosConAccesoTotal(client) === 0) {
    throw new AppError('No se puede: el sistema debe tener al menos un usuario activo con todos los permisos.', 409);
  }
}

async function obtenerRol(client, idRol, bloquear = false) {
  const { rows } = await client.query(
    `SELECT id_rol, nombre, descripcion, estado FROM tb_roles WHERE id_rol = $1${bloquear ? ' FOR UPDATE' : ''}`,
    [idRol],
  );
  if (!rows[0]) throw new AppError('Rol no encontrado.', 404);
  return rows[0];
}

function validarIdRol(idRol) {
  const id = Number(idRol);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new AppError('El identificador del rol no es válido.', 400);
  }
  return id;
}

async function validarNombreUnico(client, nombre, idExcluir = null) {
  const { rows } = await client.query('SELECT id_rol, nombre FROM tb_roles', []);
  const duplicado = rows.find(r => String(r.id_rol) !== String(idExcluir) && claveNombre(r.nombre) === claveNombre(nombre));
  if (duplicado) throw new AppError(`Ya existe el rol «${duplicado.nombre}». Un solo rol agrupa las formas de género.`, 409);
  validarFormaGenerica(nombre);
}

async function obtenerIdsRelaciones(client, accesos) {
  const { rows } = await client.query(`
    SELECT p.id_permiso, p.modulo, p.nombre AS permiso, pr.id_privilegio, pr.nombre AS privilegio
    FROM tb_permisos p CROSS JOIN tb_privilegio pr
    WHERE p.estado = TRUE
  `, []);
  const porClave = new Map(rows.map(row => [`${row.modulo}::${row.permiso}|${row.privilegio}`, row]));
  return accesos.map(acceso => {
    const fila = porClave.get(`${acceso.modulo}::${acceso.nombre}|${acceso.privilegio}`);
    if (!fila) throw new AppError(`El permiso o privilegio «${acceso.modulo}::${acceso.nombre} / ${acceso.privilegio}» no está disponible.`, 400);
    return fila;
  });
}

async function reemplazarRelaciones(client, idRol, accesos) {
  const relaciones = await obtenerIdsRelaciones(client, accesos);
  await client.query('DELETE FROM tb_roles_permiso WHERE id_rol = $1', [idRol]);
  const { rows: siguiente } = await client.query(
    'SELECT COALESCE(MAX(id_rolpermiso), 0) + 1 AS id FROM tb_roles_permiso',
    [],
  );
  let idRelacion = Number(siguiente[0].id);
  for (const fila of relaciones) {
    await client.query(
      'INSERT INTO tb_roles_permiso (id_rolpermiso, id_rol, id_permiso, id_privilegio) VALUES ($1, $2, $3, $4)',
      [idRelacion, idRol, fila.id_permiso, fila.id_privilegio],
    );
    idRelacion += 1;
  }
}

async function validarNoQuitarPermisosAdministrador(client, rol, nuevos) {
  if (!esAdministrador(rol.nombre)) return;
  const { rows } = await client.query(`
    SELECT p.modulo, p.nombre AS permiso, pr.nombre AS privilegio
    FROM tb_roles_permiso rp
    JOIN tb_permisos p ON p.id_permiso = rp.id_permiso
    JOIN tb_privilegio pr ON pr.id_privilegio = rp.id_privilegio
    WHERE rp.id_rol = $1
  `, [rol.id_rol]);
  const nuevasClaves = new Set(nuevos.map(x => `${x.modulo}|${x.nombre}|${x.privilegio}`));
  const removido = rows.find(x => !nuevasClaves.has(`${x.modulo}|${x.permiso}|${x.privilegio}`));
  if (removido) {
    throw new AppError('No se pueden quitar permisos al rol Administrador.', 403);
  }
}

async function datosRolDesdeBody(client, body, { crear = false } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError('Envía los datos del rol.', 400);
  const nombre = validarNombre(body.nombre);
  if (typeof body.descripcion !== 'string') throw new AppError('La descripción debe ser texto.', 400);
  if (typeof body.activo !== 'boolean') throw new AppError('El estado debe ser activo o inactivo.', 400);
  if (!crear && !body.accesos) throw new AppError('Los accesos del rol son obligatorios.', 400);
  const { permisos, privilegios } = await obtenerCatalogo(client);
  const accesos = validarAccesos(body.accesos ?? {}, permisos, privilegios.map(p => p.nombre));
  return { nombre, descripcion: body.descripcion.trim(), activo: body.activo, accesos };
}

export async function crearRol(body) {
  return transaction(async client => {
    await bloquearCambiosDeRoles(client);
    const datos = await datosRolDesdeBody(client, body, { crear: true });
    await validarNombreUnico(client, datos.nombre);
    const { rows: siguiente } = await client.query(
      'SELECT COALESCE(MAX(id_rol), 0) + 1 AS id FROM tb_roles',
      [],
    );
    const idRol = Number(siguiente[0].id);
    await client.query(
      'INSERT INTO tb_roles (id_rol, nombre, descripcion, estado) VALUES ($1, $2, $3, $4)',
      [idRol, datos.nombre, datos.descripcion, datos.activo],
    );
    await reemplazarRelaciones(client, idRol, datos.accesos);
    const roles = await listarRolesCon(client);
    return roles.find(rol => rol.id === String(idRol));
  });
}

export async function editarRol(idRol, body) {
  idRol = validarIdRol(idRol);
  return transaction(async client => {
    await bloquearCambiosDeRoles(client);
    const rol = await obtenerRol(client, idRol, true);
    if (esRolBase(rol.nombre)) {
      throw new AppError('Este rol base no se puede editar', 403);
    }
    if (rol.estado) {
      throw new AppError('Desactiva el rol antes de editarlo', 403);
    }
    const datos = await datosRolDesdeBody(client, body);
    if (datos.activo) {
      throw new AppError('El rol debe permanecer inactivo mientras se edita. Actívalo después desde su estado.', 400);
    }
    await validarNombreUnico(client, datos.nombre, idRol);
    await validarNoQuitarPermisosAdministrador(client, rol, datos.accesos);
    const totalAntes = await contarUsuariosConAccesoTotal(client);
    await client.query(
      'UPDATE tb_roles SET nombre = $1, descripcion = $2, estado = $3 WHERE id_rol = $4',
      [datos.nombre, datos.descripcion, datos.activo, idRol],
    );
    await reemplazarRelaciones(client, idRol, datos.accesos);
    await asegurarNoEliminarUltimoAccesoTotal(client, totalAntes);
    const roles = await listarRolesCon(client);
    return roles.find(item => item.id === String(idRol));
  });
}

export async function cambiarEstadoRol(idRol, estado) {
  idRol = validarIdRol(idRol);
  if (typeof estado !== 'boolean') throw new AppError('El estado debe ser activo o inactivo.', 400);
  return transaction(async client => {
    await bloquearCambiosDeRoles(client);
    const rol = await obtenerRol(client, idRol, true);
    if (esRolBase(rol.nombre) && !estado) throw new AppError('No se puede desactivar un rol base.', 403);
    const totalAntes = await contarUsuariosConAccesoTotal(client);
    await client.query('UPDATE tb_roles SET estado = $1 WHERE id_rol = $2', [estado, idRol]);
    await asegurarNoEliminarUltimoAccesoTotal(client, totalAntes);
    const roles = await listarRolesCon(client);
    return roles.find(item => item.id === String(idRol));
  });
}

export async function eliminarRol(idRol) {
  idRol = validarIdRol(idRol);
  return transaction(async client => {
    await bloquearCambiosDeRoles(client);
    const rol = await obtenerRol(client, idRol, true);
    if (esRolBase(rol.nombre)) throw new AppError('No se puede eliminar un rol base.', 403);
    const asignados = await client.query(`
      SELECT COUNT(DISTINCT id_usuario)::int AS cantidad FROM (
        SELECT id_usuario FROM tb_usuarios WHERE id_rol = $1
        UNION
        SELECT e.id_usuario FROM tb_empleado_roles er
        JOIN tb_contratacion_empleado ce ON ce.id_contrato = er.id_contrato
        JOIN tb_empleado e ON e.id_empleado = ce.id_empleado
        WHERE er.id_rol = $1
      ) vinculados
    `, [idRol]);
    if (Number(asignados.rows[0]?.cantidad ?? 0) > 0) {
      throw new AppError(`No se puede eliminar el rol porque tiene ${asignados.rows[0].cantidad} usuario(s) asignado(s).`, 409);
    }
    const totalAntes = await contarUsuariosConAccesoTotal(client);
    await client.query('DELETE FROM tb_roles_permiso WHERE id_rol = $1', [idRol]);
    await client.query('DELETE FROM tb_roles WHERE id_rol = $1', [idRol]);
    await asegurarNoEliminarUltimoAccesoTotal(client, totalAntes);
    return { mensaje: 'Rol eliminado correctamente.' };
  });
}
