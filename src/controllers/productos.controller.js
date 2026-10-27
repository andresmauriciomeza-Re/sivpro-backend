import { query } from '../config/db.js';
import AppError from '../errors/AppError.js';
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
              p.imagen_data IS NOT NULL AS tiene_imagen,
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
              p.imagen_data IS NOT NULL AS tiene_imagen,
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

/** Imagen binaria de un producto (GET /productos/:id/imagen).
    Pensada para el catálogo público: NO pide autenticación, solo sirve los
    bytes que guardó `scripts/cargar-imagenes.js` en `imagen_data`.
    `imagen_data` NUNCA viaja en los JSON del catálogo (eso lo satura); el
    listado solo informa `tiene_imagen` y el frontend pide la imagen acá.
    Se cachea 1 hora: los bytes de un producto no cambian con frecuencia. */
export async function obtenerImagenProducto(req, res, next) {
  try {
    const id = validarIdProducto(req.params.id);
    const { rows } = await query(
      `SELECT imagen_data, imagen_tipo
         FROM tb_productos
        WHERE id_producto = $1`,
      [id]
    );
    const producto = rows[0];
    if (!producto) throw new AppError('Producto no encontrado.', 404);
    if (!producto.imagen_data) throw new AppError('El producto no tiene imagen.', 404);

    res.set('Content-Type', producto.imagen_tipo || 'application/octet-stream');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(producto.imagen_data);
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
