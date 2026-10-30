import AppError from '../errors/AppError.js';
import { transaction } from '../config/db.js';
import normalizarCategoria from '../utils/normalizarCategoria.js';
import { redondearDosDecimales } from '../utils/insumos.js';

/** Categorías que exigen un único tipo de producto. Las que no están en la
    lista (p. ej. "pollo") aceptan tanto Elaborado como Reventa. */
const TIPO_EXIGIDO_POR_CATEGORIA = {
  pizza: 'Elaborado',
  lasana: 'Elaborado',
  bebidas: 'Reventa',
};

function verificarCoherenciaTipoCategoria(nombreCategoria, tipo) {
  const esperado = TIPO_EXIGIDO_POR_CATEGORIA[normalizarCategoria(nombreCategoria)];
  if (esperado && esperado !== tipo) {
    throw new AppError('El tipo no corresponde a la categoría', 400);
  }
}

/** Mismo SELECT que GET /productos/gestion (idénticas columnas y aliases),
    filtrado por id: es lo que devuelven POST, PUT, PATCH y las dos de compra
    para que todas respondan "en el formato de /gestion". */
const COLUMNAS_GESTION = `
  p.id_producto, p.id_categoria, p.nombre, p.tipo,
  p.precio_venta, p.costo_unitario, p.unidad_venta, p.stock,
  p.imagen, p.estado,
  p.contenido, p.contenido_unidad, p.unidad_compra,
  p.unidades_por_empaque, p.ultimo_monto_sin_iva, p.ultimo_iva_compra,
  p.ultimo_monto_digitado,
  c.nombre AS categoria_nombre, c.descripcion AS categoria_descripcion,
  c.emoji AS categoria_emoji, c.estado AS categoria_estado,
  p.precio_grande`;

function validarPrecioGrande(tipo, nombreCategoria, precioVenta, precioGrande) {
  if (precioGrande === null || precioGrande === undefined) return;
  if (tipo !== 'Elaborado' || normalizarCategoria(nombreCategoria) !== 'pizza') {
    throw new AppError('Solo las pizzas tienen precio para tamaño Grande', 400);
  }
  if (Number(precioGrande) <= Number(precioVenta)) {
    throw new AppError('El precio Grande debe ser mayor que el precio Mediana', 400);
  }
}

async function traerProductoGestion(conexion, idProducto) {
  const { rows } = await conexion.query(
    `SELECT ${COLUMNAS_GESTION}
       FROM tb_productos p
       JOIN tb_categoria_productos c ON c.id_categoria = p.id_categoria
      WHERE p.id_producto = $1`,
    [idProducto]
  );
  if (!rows[0]) throw new AppError('Producto no encontrado.', 404);
  return rows[0];
}

async function categoriaActiva(conexion, idCategoria) {
  const { rows } = await conexion.query(
    `SELECT id_categoria, nombre, estado
       FROM tb_categoria_productos
      WHERE id_categoria = $1`,
    [idCategoria]
  );
  const categoria = rows[0];
  if (!categoria || !categoria.estado) {
    throw new AppError('La categoría no existe o está inactiva.', 400);
  }
  return categoria;
}

/** Mapeo de errores de PostgreSQL idéntico al de ventas.service.js, con el
    nombre repetido de tb_productos traducido a su propio mensaje. */
function mapearError(error) {
  if (error instanceof AppError) return error;
  if (error?.code === '23514' && error?.constraint === 'ck_productos_precio_grande') {
    return new AppError('El precio Grande debe ser mayor que el precio Mediana', 400);
  }
  if (error?.code === '23505') {
    if (error?.constraint === 'tb_productos_nombre_key') {
      return new AppError('Ya existe un producto con ese nombre', 409);
    }
    return new AppError('Ya existe un registro con esos datos.', 409);
  }
  if (error?.code === '23503' || error?.code === '23514' || error?.code === '22P02') {
    console.error('Restricción/valor inválido en operación de productos:', error.code, error.constraint);
    return new AppError('Los datos del producto no cumplen las reglas de la base de datos.', 400);
  }
  console.error('Error de base de datos en productos:', error?.code, error?.constraint);
  console.error(error);
  return new AppError('No se pudo completar la operación de productos.', 503);
}

/**
 * POST /api/productos
 * Todos los productos nacen 'No disponible' porque se crean con stock 0.
 * Reventa: nace SIEMPRE en precio 0, costo 0, stock 0 y 'No disponible',
 * aunque el body traiga otro precio (los campos de compra los pone la entrada
 * de compra).
 * id_producto no se envía: es IDENTITY.
 */
export async function crearProducto(datos) {
  try {
    return await transaction(async (client) => {
      const categoria = await categoriaActiva(client, datos.id_categoria);
      validarPrecioGrande(datos.tipo, categoria.nombre, datos.precio_venta, datos.precio_grande);
      verificarCoherenciaTipoCategoria(categoria.nombre, datos.tipo);

      const esElaborado = datos.tipo === 'Elaborado';
      const { rows } = await client.query(
        `INSERT INTO tb_productos
           (id_categoria, nombre, tipo, unidad_venta, imagen,
            precio_venta, precio_grande, costo_unitario, stock, estado,
            contenido, contenido_unidad, unidad_compra, unidades_por_empaque,
            ultimo_monto_sin_iva, ultimo_iva_compra, ultimo_monto_digitado)
         VALUES ($1, $2, $3, $4, $5,
                 $6, $7, 0, 0, $8,
                 $9, $10, $11, $12,
                 NULL, NULL, NULL)
         RETURNING id_producto`,
        [
          datos.id_categoria,
          datos.nombre,
          datos.tipo,
          datos.unidad_venta,
          datos.imagen,
          esElaborado ? datos.precio_venta : 0,
          datos.precio_grande,
          'No disponible',
          datos.contenido,
          datos.contenido_unidad,
          datos.unidad_compra,
          datos.unidades_por_empaque,
        ]
      );
      return await traerProductoGestion(client, rows[0].id_producto);
    });
  } catch (error) {
    throw mapearError(error);
  }
}

/** Une los campos de bebida del body con lo que ya tiene el producto para
    decidir QUÉ escribir (nunca se manda un campo que no cambió). */
function combinarBebida(actual, datos) {
  const hayBebida =
    datos.contenido !== undefined ||
    datos.contenido_unidad !== undefined ||
    datos.unidad_compra !== undefined ||
    datos.unidades_por_empaque !== undefined;
  if (!hayBebida) return {};

  const cambios = {};
  if (datos.contenido !== undefined) cambios.contenido = datos.contenido;
  if (datos.contenido_unidad !== undefined) cambios.contenido_unidad = datos.contenido_unidad;

  const unidadCompra = datos.unidad_compra !== undefined ? datos.unidad_compra : actual.unidad_compra;
  if (datos.unidad_compra !== undefined && datos.unidad_compra !== actual.unidad_compra) {
    cambios.unidad_compra = datos.unidad_compra;
  }
  // Sin unidad de compra registrada no hay regla de empaque que aplicar.
  if (unidadCompra === null || unidadCompra === undefined) return cambios;

  let unidadesPorEmpaque;
  if (unidadCompra === 'und') {
    unidadesPorEmpaque = null; // con 'und' va NULL
  } else if (datos.unidades_por_empaque !== undefined) {
    unidadesPorEmpaque = datos.unidades_por_empaque;
  } else if (actual.unidades_por_empaque !== null && actual.unidades_por_empaque !== undefined) {
    unidadesPorEmpaque = actual.unidades_por_empaque;
  } else {
    throw new AppError(
      'Las bebidas compradas en paca o caja deben indicar unidades por empaque (mínimo 2).',
      400
    );
  }
  const actualEmpaque = actual.unidades_por_empaque ?? null;
  if (unidadesPorEmpaque !== actualEmpaque) {
    cambios.unidades_por_empaque = unidadesPorEmpaque;
  }

  return cambios;
}

/**
 * PUT /api/productos/:id — actualización parcial.
 * Cambia nombre, id_categoria, unidad_venta, imagen y, en bebidas, los campos
 * de contenido/empaque. En Elaborado puede cambiar precio_venta (> 0).
 * NUNCA cambia tipo ni stock; en Reventa ignora precio_venta, costo_unitario
 * y stock aunque vengan en el body.
 */
export async function editarProducto(idProducto, datos) {
  try {
    return await transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT p.id_producto, p.id_categoria, p.tipo, p.unidad_compra,
                p.unidades_por_empaque, p.precio_venta, p.precio_grande,
                c.nombre AS categoria_nombre
           FROM tb_productos p
           JOIN tb_categoria_productos c ON c.id_categoria = p.id_categoria
          WHERE p.id_producto = $1
          FOR UPDATE OF p`,
        [idProducto]
      );
      const actual = rows[0];
      if (!actual) throw new AppError('Producto no encontrado.', 404);

      if (datos.tipo !== undefined && datos.tipo !== actual.tipo) {
        throw new AppError('El tipo de producto no se puede cambiar.', 400);
      }

      const cambios = {};
      let categoriaFinal = { nombre: actual.categoria_nombre };
      if (datos.nombre !== undefined) cambios.nombre = datos.nombre;
      if (datos.unidad_venta !== undefined) cambios.unidad_venta = datos.unidad_venta;
      if (datos.imagen !== undefined) cambios.imagen = datos.imagen;

      if (datos.id_categoria !== undefined && datos.id_categoria !== actual.id_categoria) {
        const categoria = await categoriaActiva(client, datos.id_categoria);
        verificarCoherenciaTipoCategoria(categoria.nombre, actual.tipo);
        categoriaFinal = categoria;
        cambios.id_categoria = datos.id_categoria;
      }

      const precioVentaFinal = actual.tipo === 'Elaborado' && datos.precio_venta !== undefined
        ? datos.precio_venta
        : actual.precio_venta;
      const precioGrandeFinal = datos.precio_grande !== undefined
        ? datos.precio_grande
        : actual.precio_grande;
      validarPrecioGrande(actual.tipo, categoriaFinal.nombre, precioVentaFinal, precioGrandeFinal);

      if (actual.tipo === 'Reventa') {
        Object.assign(cambios, combinarBebida(actual, datos));
        // precio_venta / costo_unitario / stock: fuera de esta ruta.
      } else if (datos.precio_venta !== undefined) {
        cambios.precio_venta = datos.precio_venta;
      }
      if (datos.precio_grande !== undefined) cambios.precio_grande = datos.precio_grande;

      if (Object.keys(cambios).length > 0) {
        const asignaciones = Object.keys(cambios)
          .map((columna, indice) => `${columna} = $${indice + 2}`)
          .join(', ');
        await client.query(
          `UPDATE tb_productos SET ${asignaciones} WHERE id_producto = $1`,
          [idProducto, ...Object.values(cambios)]
        );
      }

      return await traerProductoGestion(client, idProducto);
    });
  } catch (error) {
    throw mapearError(error);
  }
}

/**
 * PATCH /api/productos/:id/estado
 * Los cambios manuales permiten descontinuar o devolver el producto al estado
 * automático, que el trigger resuelve según el stock.
 */
export async function cambiarEstadoProducto(idProducto, estado) {
  try {
    return await transaction(async (client) => {
      if (!['Descontinuado', 'Automático'].includes(estado)) {
        throw new AppError("El estado debe ser 'Descontinuado' o 'Automático'.", 400);
      }

      const { rows } = await client.query(
        `SELECT id_producto, tipo, precio_venta
           FROM tb_productos
          WHERE id_producto = $1
          FOR UPDATE`,
        [idProducto]
      );
      const actual = rows[0];
      if (!actual) throw new AppError('Producto no encontrado.', 404);

      if (
        estado === 'Automático' &&
        actual.tipo === 'Reventa' &&
        Number(actual.precio_venta) === 0
      ) {
        throw new AppError(
          'Esta bebida aún no tiene precio: registra una compra antes de ponerla disponible',
          400
        );
      }

      const estadoFinal = estado === 'Automático' ? 'No disponible' : estado;
      await client.query(`UPDATE tb_productos SET estado = $2 WHERE id_producto = $1`, [
        idProducto,
        estadoFinal,
      ]);
      return await traerProductoGestion(client, idProducto);
    });
  } catch (error) {
    throw mapearError(error);
  }
}

/**
 * POST /api/productos/:id/entrada-compra
 * Una sola transacción con bloqueo FOR UPDATE: suma stock, guarda el costo y
 * el precio de venta por unidad con IVA y deja la bebida 'Disponible' solo si
 * estaba 'No disponible' con precio anterior 0. 'Descontinuado' no cambia.
 */
export async function registrarEntradaCompraEnTransaccion(client, idProducto, datos) {
  const { rows } = await client.query(
    `SELECT id_producto, nombre, tipo, stock, costo_unitario, precio_venta
       FROM tb_productos
      WHERE id_producto = $1
      FOR UPDATE`,
    [idProducto]
  );
  const actual = rows[0];
  if (!actual) throw new AppError('Producto no encontrado.', 404);
  if (actual.tipo !== 'Reventa') {
    throw new AppError('Solo las bebidas (tipo Reventa) admiten entrada de compra.', 400);
  }

  // Un mismo producto de reventa puede comprarse a proveedores distintos: el
  // stock se SUMA, el precio de venta es SIEMPRE el más alto (GREATEST, por
  // unidad con IVA; una compra más barata nunca lo baja) y el costo pasa a
  // ser el promedio PONDERADO por unidades. Con stock actual 0 el costo es
  // directamente el de la compra nueva. `actual` viene de la fila bloqueada
  // FOR UPDATE, así que el cálculo no se cruza con otra entrada concurrente.
  const stockActual = Number(actual.stock ?? 0);
  const unidades = Number(datos.unidades);
  const costoUnitario = stockActual > 0
    ? redondearDosDecimales(
      (stockActual * Number(actual.costo_unitario) + unidades * Number(datos.costo_unitario)) /
      (stockActual + unidades)
    )
    : redondearDosDecimales(datos.costo_unitario);
  const precioVenta = Math.max(Number(actual.precio_venta ?? 0), Number(datos.precio_venta ?? 0));

  // El CASE lee estado y precio_venta de la fila ANTERIOR al update.
  await client.query(
    `UPDATE tb_productos
        SET stock = stock + $2,
            costo_unitario = $3,
            precio_venta = $4,
            ultimo_monto_sin_iva = $5,
            ultimo_iva_compra = $6,
            ultimo_monto_digitado = COALESCE($7, ultimo_monto_digitado),
            estado = CASE
                       WHEN estado = 'No disponible' AND precio_venta = 0
                         THEN 'Disponible'
                       ELSE estado
                     END
      WHERE id_producto = $1`,
    [
      idProducto,
      datos.unidades,
      costoUnitario,
      precioVenta,
      datos.ultimo_monto_sin_iva,
      datos.ultimo_iva_compra,
      // Punto C1: monto tal cual lo digitó el usuario (null = no viene: el
      // COALESCE conserva el último guardado).
      datos.ultimo_monto_digitado ?? null,
    ]
  );

  return traerProductoGestion(client, idProducto);
}

export async function registrarEntradaCompra(idProducto, datos) {
  try {
    return await transaction((client) => registrarEntradaCompraEnTransaccion(client, idProducto, datos));
  } catch (error) {
    throw mapearError(error);
  }
}

/**
 * POST /api/productos/:id/reversa-compra
 * Devuelve al stock las unidades compradas por error. No revierte precio ni
 * costo, y solo descuenta si todavía alcanza el stock (si no, 409).
 */
export async function revertirCompraEnTransaccion(client, idProducto, datos) {
  const { rows } = await client.query(
    `SELECT id_producto, nombre, tipo
       FROM tb_productos
      WHERE id_producto = $1
      FOR UPDATE`,
    [idProducto]
  );
  const actual = rows[0];
  if (!actual) throw new AppError('Producto no encontrado.', 404);
  if (actual.tipo !== 'Reventa') {
    throw new AppError('Solo las bebidas (tipo Reventa) admiten reversa de compra.', 400);
  }

  const { rowCount } = await client.query(
    `UPDATE tb_productos
        SET stock = stock - $2
      WHERE id_producto = $1
        AND tipo = 'Reventa'
        AND stock >= $2`,
    [idProducto, datos.unidades]
  );
  if (rowCount === 0) {
    throw new AppError(
      `No se puede revertir: ya se vendieron unidades de «${actual.nombre}»`,
      409
    );
  }

  return traerProductoGestion(client, idProducto);
}

export async function revertirCompra(idProducto, datos) {
  try {
    return await transaction((client) => revertirCompraEnTransaccion(client, idProducto, datos));
  } catch (error) {
    throw mapearError(error);
  }
}
