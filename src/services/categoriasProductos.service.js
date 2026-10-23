import AppError from '../errors/AppError.js';
import { query, transaction } from '../config/db.js';
import { CATEGORIAS_FIJAS, claveNombreCategoria } from '../validators/categoriasProductos.validator.js';

// Categorías de producto (tb_categoria_productos), gestión desde el panel.
// El GET público /categorias-productos (productos.controller.js) sigue
// devolviendo solo las activas. Una categoría inactiva oculta sus productos
// del menú público y no admite productos nuevos (productos.service.js).

const MENSAJE_CON_PRODUCTOS = 'Esta categoría tiene productos asociados. Puedes inactivarla.';
const MENSAJE_NOMBRE_REPETIDO = 'Ya existe una categoría con ese nombre.';

// `productos_menu` usa el mismo filtro que el menú público: son los productos
// que se dejan de ver al inactivar la categoría.
const SELECT_GESTION = `
  SELECT c.id_categoria, c.nombre, c.descripcion, c.emoji, c.estado,
         COUNT(p.id_producto)::int AS total_productos,
         COUNT(p.id_producto) FILTER (
           WHERE p.estado IN ('Disponible', 'No disponible') AND p.precio_venta > 0
         )::int AS productos_menu
    FROM tb_categoria_productos c
    LEFT JOIN tb_productos p ON p.id_categoria = c.id_categoria`;

function mapearError(error) {
  if (error instanceof AppError) return error;
  if (error?.code === '23505') return new AppError(MENSAJE_NOMBRE_REPETIDO, 409);
  if (error?.code === '23503') return new AppError(MENSAJE_CON_PRODUCTOS, 409);
  if (error?.code === '22001' || error?.code === '23502' || error?.code === '23514' || error?.code === '22P02') {
    return new AppError('Los datos de la categoría no cumplen las reglas de la base de datos.', 400);
  }
  console.error('Error de base de datos en categorías de producto:', error?.code, error?.constraint);
  console.error(error);
  return new AppError('No se pudo completar la operación de categorías de producto.', 503);
}

const esFija = (id) => CATEGORIAS_FIJAS.includes(Number(id));

async function obtenerEnConexion(conexion, id) {
  const { rows } = await conexion.query(
    `${SELECT_GESTION}
      WHERE c.id_categoria = $1
      GROUP BY c.id_categoria`,
    [id]
  );
  if (!rows[0]) throw new AppError('La categoría no existe.', 404);
  return rows[0];
}

/** Rechaza un nombre que ya existe sin importar mayúsculas, tildes ni espacios. */
async function verificarNombreLibre(client, nombre, ignorarId = null) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('tb_categoria_productos'))");
  const { rows } = await client.query('SELECT id_categoria, nombre FROM tb_categoria_productos');
  const clave = claveNombreCategoria(nombre);
  const repetida = rows.some(
    (r) => r.id_categoria !== ignorarId && claveNombreCategoria(r.nombre) === clave
  );
  if (repetida) throw new AppError(MENSAJE_NOMBRE_REPETIDO, 409);
}

export async function listarCategoriasGestion() {
  try {
    const { rows } = await query(
      `${SELECT_GESTION}
        GROUP BY c.id_categoria
        ORDER BY c.id_categoria`
    );
    return rows;
  } catch (error) {
    throw mapearError(error);
  }
}

export async function crearCategoria(datos) {
  try {
    return await transaction(async (client) => {
      await verificarNombreLibre(client, datos.nombre);
      const { rows } = await client.query(
        `INSERT INTO tb_categoria_productos (nombre, descripcion, emoji, estado)
         VALUES ($1, $2, $3, $4)
         RETURNING id_categoria`,
        [datos.nombre, datos.descripcion, datos.emoji, datos.estado]
      );
      return obtenerEnConexion(client, rows[0].id_categoria);
    });
  } catch (error) {
    throw mapearError(error);
  }
}

export async function editarCategoria(id, datos) {
  try {
    return await transaction(async (client) => {
      const actual = await obtenerEnConexion(client, id);
      const cambiaNombre = datos.nombre !== undefined && datos.nombre !== actual.nombre;
      const cambiaIcono = datos.emoji !== undefined && datos.emoji !== actual.emoji;
      if (esFija(id) && (cambiaNombre || cambiaIcono)) {
        throw new AppError('Las categorías originales (Pizza, Lasaña y Bebidas) no pueden cambiar de nombre ni de ícono.', 403);
      }
      if (cambiaNombre) await verificarNombreLibre(client, datos.nombre, actual.id_categoria);

      const cambios = Object.entries(datos);
      const sets = cambios.map(([campo], i) => `${campo} = $${i + 1}`);
      await client.query(
        `UPDATE tb_categoria_productos
            SET ${sets.join(', ')}
          WHERE id_categoria = $${cambios.length + 1}`,
        [...cambios.map(([, valor]) => valor), id]
      );
      return obtenerEnConexion(client, id);
    });
  } catch (error) {
    throw mapearError(error);
  }
}

export async function cambiarEstadoCategoria(id, estado) {
  try {
    const { rowCount } = await query(
      'UPDATE tb_categoria_productos SET estado = $1 WHERE id_categoria = $2',
      [estado, id]
    );
    if (!rowCount) throw new AppError('La categoría no existe.', 404);
    return await obtenerEnConexion({ query }, id);
  } catch (error) {
    throw mapearError(error);
  }
}

export async function eliminarCategoria(id) {
  try {
    return await transaction(async (client) => {
      const actual = await obtenerEnConexion(client, id);
      if (esFija(id)) {
        throw new AppError('Las categorías originales (Pizza, Lasaña y Bebidas) no se pueden eliminar.', 403);
      }
      if (actual.total_productos > 0) throw new AppError(MENSAJE_CON_PRODUCTOS, 409);
      await client.query('DELETE FROM tb_categoria_productos WHERE id_categoria = $1', [id]);
      return { ok: true, id };
    });
  } catch (error) {
    throw mapearError(error);
  }
}
