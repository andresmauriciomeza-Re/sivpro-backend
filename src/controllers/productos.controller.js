import { query } from '../config/db.js';
import {
  cambiarEstadoProducto,
  crearProducto,
  editarProducto,
  registrarEntradaCompra,
  revertirCompra,
} from '../services/productos.service.js';
import {
  validarCreacionProducto,
  validarEdicionProducto,
  validarEntradaCompra,
  validarEstadoProducto,
  validarIdProducto,
  validarReversaCompra,
} from '../validators/productos.validator.js';

export async function obtenerCatalogoPublico(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT p.id_producto, p.id_categoria, p.nombre, p.tipo,
              p.precio_venta, p.unidad_venta, p.imagen, p.estado,
              c.nombre AS categoria_nombre, c.descripcion AS categoria_descripcion,
              c.emoji AS categoria_emoji, p.stock, p.precio_grande
         FROM tb_productos p
         JOIN tb_categoria_productos c ON c.id_categoria = p.id_categoria
        WHERE p.estado IN ('Disponible', 'No disponible') AND p.precio_venta > 0 AND c.estado = true
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
              p.contenido, p.contenido_unidad, p.unidad_compra,
              p.unidades_por_empaque, p.ultimo_monto_sin_iva, p.ultimo_iva_compra,
              c.nombre AS categoria_nombre, c.descripcion AS categoria_descripcion,
              c.emoji AS categoria_emoji, c.estado AS categoria_estado,
              p.precio_grande
         FROM tb_productos p
         JOIN tb_categoria_productos c ON c.id_categoria = p.id_categoria
        ORDER BY c.id_categoria, p.id_producto`
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
}

export async function crearProductoController(req, res, next) {
  try {
    const producto = await crearProducto(validarCreacionProducto(req.body));
    res.status(201).json(producto);
  } catch (error) {
    next(error);
  }
}

export async function editarProductoController(req, res, next) {
  try {
    const producto = await editarProducto(
      validarIdProducto(req.params.id),
      validarEdicionProducto(req.body)
    );
    res.json(producto);
  } catch (error) {
    next(error);
  }
}

export async function cambiarEstadoProductoController(req, res, next) {
  try {
    const producto = await cambiarEstadoProducto(
      validarIdProducto(req.params.id),
      validarEstadoProducto(req.body).estado
    );
    res.json(producto);
  } catch (error) {
    next(error);
  }
}

export async function registrarEntradaCompraController(req, res, next) {
  try {
    const producto = await registrarEntradaCompra(
      validarIdProducto(req.params.id),
      validarEntradaCompra(req.body)
    );
    res.json(producto);
  } catch (error) {
    next(error);
  }
}

export async function revertirCompraController(req, res, next) {
  try {
    const producto = await revertirCompra(
      validarIdProducto(req.params.id),
      validarReversaCompra(req.body)
    );
    res.json(producto);
  } catch (error) {
    next(error);
  }
}
