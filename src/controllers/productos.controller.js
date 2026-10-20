import { query } from '../config/db.js';

export async function obtenerCatalogoPublico(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT p.id_producto, p.id_categoria, p.nombre, p.tipo,
              p.precio_venta, p.unidad_venta, p.imagen, p.estado,
              c.nombre AS categoria_nombre, c.descripcion AS categoria_descripcion,
              c.emoji AS categoria_emoji
         FROM tb_productos p
         JOIN tb_categoria_productos c ON c.id_categoria = p.id_categoria
        WHERE p.estado = 'Disponible' AND c.estado = true
        ORDER BY c.id_categoria, p.id_producto`
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
}

export async function obtenerCategoriasPublicas(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT id_categoria, nombre, descripcion, emoji, estado
         FROM tb_categoria_productos
        WHERE estado = true
        ORDER BY id_categoria`
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
}

export async function obtenerProductosGestion(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT p.id_producto, p.id_categoria, p.nombre, p.tipo,
              p.precio_venta, p.costo_unitario, p.unidad_venta, p.stock,
              p.imagen, p.estado,
              c.nombre AS categoria_nombre, c.descripcion AS categoria_descripcion,
              c.emoji AS categoria_emoji, c.estado AS categoria_estado
         FROM tb_productos p
         JOIN tb_categoria_productos c ON c.id_categoria = p.id_categoria
        ORDER BY c.id_categoria, p.id_producto`
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
}
