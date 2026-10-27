import AppError from '../errors/AppError.js';
import { query, transaction } from '../config/db.js';

const COLUMNAS = `id_proveedor, tipo_persona, nit, dv, nombre, nombre_comercial,
  tipo_documento, numero_documento, tipo_sociedad, camara_comercio, fecha_exp_camara,
  rep_legal_nombre, rep_legal_tipo_doc, rep_legal_num_doc, rep_legal_telefono, rep_legal_email,
  asesor_comercial, telefono, contacto_telefono_fijo, email, direccion, estado`;

function mapearError(error) {
  if (error instanceof AppError) return error;
  if (error?.code === '23505') {
    const constraint = String(error.constraint || '');
    if (constraint.includes('natural_doc') || constraint.includes('documento')) {
      return new AppError('Ya existe un proveedor con ese número de documento', 409);
    }
    if (constraint.includes('nit')) return new AppError('Ya existe un proveedor con ese NIT', 409);
    if (constraint.includes('email') || constraint.includes('correo')) {
      return new AppError('Ya existe un proveedor con ese correo', 409);
    }
    return new AppError('Ya existe un proveedor con esos datos.', 409);
  }
  if (error?.code === '23503') return new AppError('El proveedor tiene datos relacionados que no existen.', 400);
  if (error?.code === '23514' || error?.code === '22P02') return new AppError('Los datos del proveedor no son válidos.', 400);
  console.error('Error de base de datos en proveedores:', error?.code, error?.constraint);
  console.error(error);
  return new AppError('No se pudo completar la operación de proveedores.', 503);
}

async function validarUnicos(client, datos, excluir = null) {
  if (datos.tipo_persona === 'Juridica') {
    const nitBase = String(datos.nit ?? '').replace(/\D/g, '').slice(0, 9);
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`proveedor-nit:${nitBase}`]);
    const { rows: nitRows } = await client.query(
      `SELECT EXISTS (
         SELECT 1 FROM tb_proveedores
          WHERE (nit = $1 OR nit = $2)
            AND ($3::integer IS NULL OR id_proveedor <> $3)
       ) AS existe`,
      [datos.nit, nitBase, excluir]
    );
    if (nitRows[0].existe) throw new AppError('Ya existe un proveedor con ese NIT', 409);
  } else {
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      [`proveedor-doc:${datos.tipo_documento}:${datos.numero_documento}`]
    );
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`proveedor-nit:${datos.nit}`]);
    const { rows: docRows } = await client.query(
      `SELECT EXISTS (
         SELECT 1 FROM tb_proveedores
          WHERE (
            nit = $1
            OR (tipo_persona = 'Natural' AND tipo_documento = $2 AND numero_documento = $3)
          )
          AND ($4::integer IS NULL OR id_proveedor <> $4)
       ) AS existe`,
      [datos.nit, datos.tipo_documento, datos.numero_documento, excluir]
    );
    if (docRows[0].existe) throw new AppError('Ya existe un proveedor con ese número de documento', 409);
  }

  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`proveedor-email:${datos.email}`]);
  const { rows: emailRows } = await client.query(
    'SELECT EXISTS (SELECT 1 FROM tb_proveedores WHERE lower(email) = lower($1) AND ($2::integer IS NULL OR id_proveedor <> $2)) AS existe',
    [datos.email, excluir]
  );
  if (emailRows[0].existe) throw new AppError('Ya existe un proveedor con ese correo', 409);
}

export async function listarProveedores(estado) {
  const valores = [];
  const where = estado === undefined ? '' : (valores.push(estado), 'WHERE estado = $1');
  const { rows } = await query(`SELECT ${COLUMNAS} FROM tb_proveedores ${where} ORDER BY nombre`, valores);
  return rows.map((row) => ({ ...row, id_proveedor: Number(row.id_proveedor) }));
}

export async function obtenerProveedor(idProveedor) {
  const { rows } = await query(`SELECT ${COLUMNAS} FROM tb_proveedores WHERE id_proveedor = $1`, [idProveedor]);
  if (!rows[0]) throw new AppError('Proveedor no encontrado.', 404);
  return { ...rows[0], id_proveedor: Number(rows[0].id_proveedor) };
}

export async function crearProveedor(datos) {
  try {
    return await transaction(async (client) => {
      await validarUnicos(client, datos);
      const columnas = Object.keys(datos);
      const valores = columnas.map((columna) => datos[columna]);
      const placeholders = columnas.map((_, indice) => `$${indice + 1}`);
      const { rows } = await client.query(
        `INSERT INTO tb_proveedores (${columnas.join(', ')})
         VALUES (${placeholders.join(', ')})
         RETURNING ${COLUMNAS}`,
        valores
      );
      return { ...rows[0], id_proveedor: Number(rows[0].id_proveedor) };
    });
  } catch (error) {
    throw mapearError(error);
  }
}

export async function actualizarProveedor(idProveedor, datos) {
  try {
    return await transaction(async (client) => {
      const { rows: actuales } = await client.query(
        `SELECT id_proveedor, tipo_persona, nit, dv, tipo_documento, numero_documento
           FROM tb_proveedores
          WHERE id_proveedor = $1
          FOR UPDATE`,
        [idProveedor]
      );
      if (!actuales[0]) throw new AppError('Proveedor no encontrado.', 404);
      if (datos.tipo_persona !== actuales[0].tipo_persona) {
        throw new AppError('El tipo_persona del proveedor no se puede cambiar.', 400);
      }
      if (actuales[0].tipo_persona === 'Juridica' && datos.nit !== actuales[0].nit) {
        throw new AppError('El NIT del proveedor no se puede modificar después de creado.', 400);
      }
      if (actuales[0].tipo_persona === 'Natural') {
        if (datos.tipo_documento !== actuales[0].tipo_documento) {
          throw new AppError('El tipo de documento del proveedor no se puede modificar después de creado.', 400);
        }
        if (datos.numero_documento !== actuales[0].numero_documento) {
          throw new AppError('El número de documento del proveedor no se puede modificar después de creado.', 400);
        }
        datos.nit = actuales[0].nit;
        datos.dv = actuales[0].dv ?? null;
      }
      await validarUnicos(client, datos, idProveedor);
      const columnas = Object.keys(datos);
      const asignaciones = columnas.map((columna, indice) => `${columna} = $${indice + 2}`).join(', ');
      await client.query(`UPDATE tb_proveedores SET ${asignaciones} WHERE id_proveedor = $1`, [
        idProveedor,
        ...columnas.map((columna) => datos[columna]),
      ]);
      const { rows } = await client.query(`SELECT ${COLUMNAS} FROM tb_proveedores WHERE id_proveedor = $1`, [idProveedor]);
      return { ...rows[0], id_proveedor: Number(rows[0].id_proveedor) };
    });
  } catch (error) {
    throw mapearError(error);
  }
}

export async function cambiarEstadoProveedor(idProveedor, estado) {
  try {
    return await transaction(async (client) => {
      const { rowCount } = await client.query('UPDATE tb_proveedores SET estado = $2 WHERE id_proveedor = $1', [idProveedor, estado]);
      if (!rowCount) throw new AppError('Proveedor no encontrado.', 404);
      const { rows } = await client.query(`SELECT ${COLUMNAS} FROM tb_proveedores WHERE id_proveedor = $1`, [idProveedor]);
      return { ...rows[0], id_proveedor: Number(rows[0].id_proveedor) };
    });
  } catch (error) {
    throw mapearError(error);
  }
}

export async function eliminarProveedor(idProveedor) {
  try {
    return await transaction(async (client) => {
      const { rows } = await client.query('SELECT id_proveedor, nombre FROM tb_proveedores WHERE id_proveedor = $1 FOR UPDATE', [idProveedor]);
      if (!rows[0]) throw new AppError('Proveedor no encontrado.', 404);
      const { rows: ordenes } = await client.query(
        'SELECT EXISTS (SELECT 1 FROM tb_ordencompras WHERE id_proveedor = $1) AS tiene_ordenes',
        [idProveedor]
      );
      const { rows: compras } = await client.query(
        'SELECT EXISTS (SELECT 1 FROM tb_compras WHERE id_proveedor = $1) AS tiene_compras',
        [idProveedor]
      );
      if (ordenes[0].tiene_ordenes || compras[0].tiene_compras) {
        throw new AppError('No se puede eliminar: el proveedor tiene historial. Desactívalo.', 409);
      }
      await client.query('DELETE FROM tb_proveedores WHERE id_proveedor = $1', [idProveedor]);
      return { message: 'Proveedor eliminado.' };
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error?.code === '23503') {
      throw new AppError('No se puede eliminar: el proveedor tiene historial. Desactívalo.', 409);
    }
    throw mapearError(error);
  }
}
