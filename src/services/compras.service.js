import AppError from '../errors/AppError.js';
import { query, transaction } from '../config/db.js';
import { registrarEntradaCompraEnTransaccion, revertirCompraEnTransaccion } from './productos.service.js';
import { recalcularRecepcionEnTransaccion } from './recepcionOrden.service.js';
import { convertirCantidadCompra, calcularImporteLinea } from '../utils/compras.js';
import { compararNombreInsumo, normalizarNombreInsumo, redondearDosDecimales } from '../utils/insumos.js';

function mapearError(error) {
  if (error instanceof AppError) return error;
  if (error?.code === '23505') return new AppError('Ya existe un registro de compra con esos datos.', 409);
  if (error?.code === '23503') return new AppError('El proveedor, la orden o alguno de los artículos no existe.', 400);
  if (error?.code === '23514' || error?.code === '23502' || error?.code === '22P02') {
    return new AppError('Los datos de la compra no cumplen las reglas de la base de datos.', 400);
  }
  console.error('Error de base de datos en compras:', error?.code, error?.constraint);
  console.error(error);
  return new AppError('No se pudo completar la operación de compras.', 503);
}

function validarFechaCalendario(fecha) {
  if (typeof fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fecha.trim())) {
    throw new AppError('La fecha de la compra es obligatoria y debe tener formato YYYY-MM-DD.', 400);
  }
  const limpia = fecha.trim();
  const [anio, mes, dia] = limpia.split('-').map(Number);
  const parsed = new Date(Date.UTC(anio, mes - 1, dia));
  if (parsed.toISOString().slice(0, 10) !== limpia) {
    throw new AppError('La fecha de la compra no es válida.', 400);
  }
}

async function obtenerCompraEnConexion(client, idCompra) {
  const ejecutar = typeof client === 'function' ? client : client.query.bind(client);
  const { rows } = await ejecutar(
    `SELECT c.*, p.nombre AS proveedor_nombre
       FROM tb_compras c
       LEFT JOIN tb_proveedores p ON p.id_proveedor = c.id_proveedor
      WHERE c.id_compra = $1`,
    [idCompra]
  );
  if (!rows[0]) throw new AppError('Compra no encontrada.', 404);
  const { rows: detalles } = await ejecutar(
    `SELECT id_dcompra, id_compra, id_insumo, id_producto, cantidad, medida,
            precio_unitario, iva, base_sin_iva, monto_iva, subtotal,
            es_no_solicitado, nombre
       FROM tb_detallecompra
      WHERE id_compra = $1
      ORDER BY id_dcompra`,
    [idCompra]
  );
  const compra = { ...rows[0] };
  for (const campo of ['id_compra', 'id_ocompra', 'id_proveedor']) {
    compra[campo] = compra[campo] == null ? null : Number(compra[campo]);
  }
  for (const campo of ['subtotal_sin_iva', 'total_iva', 'total']) compra[campo] = Number(compra[campo]);
  compra.detalle = detalles.map((detalle) => ({
    ...detalle,
    id_dcompra: Number(detalle.id_dcompra),
    id_compra: Number(detalle.id_compra),
    id_insumo: detalle.id_insumo == null ? null : Number(detalle.id_insumo),
    id_producto: detalle.id_producto == null ? null : Number(detalle.id_producto),
    cantidad: Number(detalle.cantidad),
    precio_unitario: Number(detalle.precio_unitario),
    iva: Number(detalle.iva),
    base_sin_iva: Number(detalle.base_sin_iva),
    monto_iva: Number(detalle.monto_iva),
    subtotal: Number(detalle.subtotal),
  }));
  return compra;
}

async function validarProveedor(client, idProveedor, { debeEstarActivo = true } = {}) {
  if (idProveedor == null) return null;
  const { rows } = await client.query(
    `SELECT id_proveedor, nombre, estado
       FROM tb_proveedores
      WHERE id_proveedor = $1
      ${debeEstarActivo ? 'FOR SHARE' : ''}`,
    [idProveedor]
  );
  if (!rows[0]) throw new AppError('Proveedor no encontrado.', 404);
  if (debeEstarActivo && !rows[0].estado) throw new AppError('El proveedor está inactivo.', 409);
  return rows[0];
}

/**
 * Regla 9: Crea un insumo no solicitado inexistente dentro de la misma transacción
 * de recepción, usando el mismo pg_advisory_xact_lock y validación de nombre único
 * que Insumos, y estableciendo la cantidad recibida como stock_actual inicial
 * (sin pasar luego por aplicarStockInsumo para evitar doble conteo).
 */
async function crearInsumoNoSolicitadoEnTransaccion(client, item, importe) {
  const nombre = normalizarNombreInsumo(item.nombre);
  const { rows: categorias } = await client.query(
    `SELECT id_categoria_insumo, nombre, estado
       FROM tb_categoria_insumos
      WHERE id_categoria_insumo = $1`,
    [item.id_categoria_insumo]
  );
  if (!categorias[0] || !categorias[0].estado) {
    throw new AppError('La categoría del insumo no solicitado no existe o está inactiva.', 400);
  }

  await client.query(
    'SELECT pg_advisory_xact_lock(hashtext($1))',
    [`insumo-nombre:${compararNombreInsumo(nombre)}`]
  );
  const { rows: existentes } = await client.query('SELECT id_insumo, nombre FROM tb_insumo');
  if (existentes.some((row) => compararNombreInsumo(row.nombre) === compararNombreInsumo(nombre))) {
    throw new AppError(
      `Ya existe un insumo con el nombre «${nombre}». Selecciónalo del catálogo de insumos existentes.`,
      409
    );
  }

  const unidades = Number(item.cantidad);
  if (!Number.isFinite(unidades) || unidades <= 0) {
    throw new AppError('La cantidad recibida del nuevo insumo debe ser mayor que cero.', 400);
  }
  const stockMinimo = item.stock_minimo === undefined ? 0 : Number(item.stock_minimo);
  if (!Number.isFinite(stockMinimo) || stockMinimo < 0) {
    throw new AppError('El stock_minimo del nuevo insumo no puede ser negativo.', 400);
  }
  const costoUnitario = redondearDosDecimales(importe.subtotal / unidades);

  const { rows } = await client.query(
    `INSERT INTO tb_insumo
       (id_categoria_insumo, nombre, tipo, unidad_medida, stock_actual,
        stock_minimo, stock_maximo, costo_unitario, iva, descripcion,
        tiempo_preparacion, estado)
     VALUES ($1, $2, 'Insumo', $3, $4, $5, 0, $6, $7, NULL, NULL, TRUE)
     RETURNING id_insumo, nombre`,
    [
      item.id_categoria_insumo,
      nombre,
      item.medida,
      unidades,
      stockMinimo,
      costoUnitario,
      item.iva,
    ]
  );
  return {
    id_insumo: Number(rows[0].id_insumo),
    nombre: rows[0].nombre,
  };
}

async function aplicarStockInsumo(client, item, importe, iva) {
  const { rows } = await client.query(
    `SELECT id_insumo, nombre, unidad_medida, estado
       FROM tb_insumo
      WHERE id_insumo = $1
      FOR UPDATE`,
    [item.id_insumo]
  );
  const insumo = rows[0];
  if (!insumo) throw new AppError('Insumo no encontrado.', 404);
  if (!insumo.estado) throw new AppError(`El insumo «${insumo.nombre}» está inactivo.`, 409);
  const unidades = convertirCantidadCompra(item.cantidad, item.medida, insumo.unidad_medida, insumo.nombre);
  if (unidades <= 0) throw new AppError('La cantidad convertida del insumo no es válida.', 400);
  const costoUnitario = redondearDosDecimales(importe.subtotal / unidades);
  await client.query(
    `UPDATE tb_insumo
        SET stock_actual = stock_actual + $2, costo_unitario = $3, iva = $4
      WHERE id_insumo = $1`,
    [item.id_insumo, unidades, costoUnitario, iva]
  );
  return { nombre: insumo.nombre, cantidad: item.cantidad, medida: item.medida };
}

async function aplicarStockProducto(client, item, importe, iva) {
  const { rows } = await client.query(
    `SELECT id_producto, nombre, tipo, unidad_compra, unidades_por_empaque
       FROM tb_productos
      WHERE id_producto = $1
      FOR UPDATE`,
    [item.id_producto]
  );
  const producto = rows[0];
  if (!producto) throw new AppError('Producto no encontrado.', 404);
  if (producto.tipo !== 'Reventa') throw new AppError('Solo los productos Reventa admiten compras.', 400);
  const unidadCompra = producto.unidad_compra || 'und';
  if (item.medida !== unidadCompra) {
    throw new AppError(`La medida «${item.medida}» no coincide con la unidad de compra de «${producto.nombre}» (${unidadCompra}).`, 400);
  }
  const empaque = unidadCompra === 'und' ? 1 : Number(producto.unidades_por_empaque);
  if (!Number.isFinite(empaque) || empaque < 1) throw new AppError(`«${producto.nombre}» no tiene unidades por empaque válidas.`, 400);
  const unidades = Number(item.cantidad) * empaque;
  const costoUnitario = redondearDosDecimales(importe.subtotal / unidades);
  if (item.precio_venta <= costoUnitario) {
    throw new AppError(`El precio de venta de «${producto.nombre}» debe ser mayor que el costo por unidad con IVA (${costoUnitario}).`, 400);
  }
  const montoSinIvaPresentacion = redondearDosDecimales(importe.base_sin_iva / Number(item.cantidad));
  const resultado = await registrarEntradaCompraEnTransaccion(client, item.id_producto, {
    unidades,
    costo_unitario: costoUnitario,
    precio_venta: item.precio_venta,
    ultimo_monto_sin_iva: montoSinIvaPresentacion,
    ultimo_iva_compra: iva,
  });
  return { nombre: resultado.nombre, cantidad: item.cantidad, medida: item.medida, unidades_stock: unidades };
}

/** Crea una compra y actualiza existencias usando siempre la transacción del llamador. */
export async function crearCompraEnTransaccion(client, datos, {
  id_ocompra = null,
  id_proveedor = datos.id_proveedor ?? null,
  itemsNoSolicitados = [],
  debeProveedorActivo = true,
} = {}) {
  validarFechaCalendario(datos.fecha);
  if (typeof datos.n_factura !== 'string' || !datos.n_factura.trim() || datos.n_factura.trim().length > 30) {
    throw new AppError('El número de factura es obligatorio y no puede superar 30 caracteres.', 400);
  }
  await validarProveedor(client, id_proveedor, { debeEstarActivo: debeProveedorActivo });
  const items = [
    ...datos.items.map((item) => ({ ...item, es_no_solicitado: false })),
    ...itemsNoSolicitados.map((item) => ({ ...item, es_no_solicitado: true })),
  ];
  if (!items.length) throw new AppError('La compra debe incluir al menos un ítem.', 400);

  const importes = items.map((item) => calcularImporteLinea(item.cantidad, item.precio_unitario, item.iva, datos.iva_incluido));
  const subtotalSinIva = redondearDosDecimales(importes.reduce((suma, importe) => suma + importe.base_sin_iva, 0));
  const totalIva = redondearDosDecimales(importes.reduce((suma, importe) => suma + importe.monto_iva, 0));
  const total = redondearDosDecimales(importes.reduce((suma, importe) => suma + importe.subtotal, 0));
  const { rows: compras } = await client.query(
    `INSERT INTO tb_compras
       (id_ocompra, id_proveedor, n_factura, fecha, iva_incluido,
        subtotal_sin_iva, total_iva, total, estado)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Recibido')
     RETURNING id_compra`,
    [id_ocompra, id_proveedor, datos.n_factura.trim(), datos.fecha, datos.iva_incluido, subtotalSinIva, totalIva, total]
  );
  const idCompra = Number(compras[0].id_compra);

  for (let indice = 0; indice < items.length; indice += 1) {
    const item = items[indice];
    const importe = importes[indice];
    let idInsumoDetalle = item.id_insumo;
    let nombre;
    if (item.es_no_solicitado && item.id_insumo == null && item.id_producto == null) {
      const creado = await crearInsumoNoSolicitadoEnTransaccion(client, item, importe);
      idInsumoDetalle = creado.id_insumo;
      nombre = creado.nombre;
    } else if (item.id_insumo != null) {
      const aplicado = await aplicarStockInsumo(client, item, importe, item.iva);
      nombre = aplicado.nombre;
    } else {
      const aplicado = await aplicarStockProducto(client, item, importe, item.iva);
      nombre = aplicado.nombre;
    }
    await client.query(
      `INSERT INTO tb_detallecompra
         (id_compra, id_insumo, id_producto, cantidad, medida, precio_unitario,
          iva, base_sin_iva, monto_iva, subtotal, es_no_solicitado, nombre)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [idCompra, idInsumoDetalle, item.id_producto, item.cantidad, item.medida, item.precio_unitario,
        item.iva, importe.base_sin_iva, importe.monto_iva, importe.subtotal, item.es_no_solicitado, nombre]
    );
  }
  return obtenerCompraEnConexion(client, idCompra);
}

export async function crearCompra(datos) {
  try {
    return await transaction((client) => crearCompraEnTransaccion(client, datos));
  } catch (error) {
    throw mapearError(error);
  }
}

export async function listarCompras(filtros) {
  const condiciones = [];
  const valores = [];
  for (const campo of ['estado', 'id_proveedor', 'id_ocompra']) {
    if (filtros[campo] !== undefined) {
      valores.push(filtros[campo]);
      condiciones.push(`c.${campo} = $${valores.length}`);
    }
  }
  const { rows } = await query(
    `SELECT c.id_compra FROM tb_compras c
      ${condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : ''}
      ORDER BY c.fecha DESC, c.id_compra DESC`,
    valores
  );
  const compras = [];
  for (const row of rows) compras.push(await obtenerCompraEnConexion(query, Number(row.id_compra)));
  return compras;
}

export async function obtenerCompra(idCompra) {
  return obtenerCompraEnConexion(query, idCompra);
}

export async function anularCompraEnTransaccion(client, idCompra, motivo, { recalcularRecepcion = true } = {}) {
  const { rows } = await client.query(
    `SELECT id_compra, id_ocompra, estado
       FROM tb_compras
      WHERE id_compra = $1
      FOR UPDATE`,
    [idCompra]
  );
  const compra = rows[0];
  if (!compra) throw new AppError('Compra no encontrada.', 404);
  if (compra.estado !== 'Recibido') throw new AppError('Solo se pueden anular compras en estado Recibido.', 409);
  const { rows: detalles } = await client.query(
    `SELECT id_insumo, id_producto, cantidad, medida, nombre
       FROM tb_detallecompra
      WHERE id_compra = $1
      ORDER BY id_dcompra
      FOR UPDATE`,
    [idCompra]
  );

  for (const detalle of detalles) {
    if (detalle.id_insumo != null) {
      const { rows: insumos } = await client.query(
        `SELECT id_insumo, nombre, unidad_medida, stock_actual
           FROM tb_insumo WHERE id_insumo = $1 FOR UPDATE`,
        [detalle.id_insumo]
      );
      const insumo = insumos[0];
      if (!insumo) throw new AppError(`No se puede anular: el insumo «${detalle.nombre}» no existe.`, 409);
      const unidades = convertirCantidadCompra(detalle.cantidad, detalle.medida, insumo.unidad_medida, insumo.nombre);
      const { rowCount } = await client.query(
        `UPDATE tb_insumo SET stock_actual = stock_actual - $2
          WHERE id_insumo = $1 AND stock_actual >= $2`,
        [detalle.id_insumo, unidades]
      );
      if (!rowCount) {
        throw new AppError(`No se puede anular: ya se usaron/vendieron unidades de «${insumo.nombre}»`, 409);
      }
      continue;
    }

    if (detalle.id_producto != null) {
      const { rows: productos } = await client.query(
        `SELECT id_producto, nombre, tipo, unidad_compra, unidades_por_empaque
           FROM tb_productos WHERE id_producto = $1 FOR UPDATE`,
        [detalle.id_producto]
      );
      const producto = productos[0];
      if (!producto) throw new AppError(`No se puede anular: el producto «${detalle.nombre}» no existe.`, 409);
      const empaque = detalle.medida === 'und' ? 1 : Number(producto.unidades_por_empaque);
      if (!Number.isFinite(empaque) || empaque < 1) throw new AppError(`No se puede anular: no se conoce el empaque de «${producto.nombre}».`, 409);
      try {
        await revertirCompraEnTransaccion(client, detalle.id_producto, { unidades: Number(detalle.cantidad) * empaque });
      } catch (error) {
        if (error instanceof AppError && error.statusCode === 409) {
          throw new AppError(`No se puede anular: ya se usaron/vendieron unidades de «${producto.nombre}»`, 409);
        }
        throw error;
      }
    }
  }

  await client.query(
    `UPDATE tb_compras
        SET estado = 'Anulado', motivo_anulacion = $2,
            fecha_anulacion = now() AT TIME ZONE 'America/Bogota'
      WHERE id_compra = $1`,
    [idCompra, motivo]
  );
  if (recalcularRecepcion && compra.id_ocompra != null) {
    const { completado } = await recalcularRecepcionEnTransaccion(client, Number(compra.id_ocompra));
    if (!completado) {
      const { rows: estados } = await client.query(
        `SELECT estado FROM tb_estadooc WHERE id_ocompra = $1 ORDER BY fecha_estado DESC, id_estadooc DESC LIMIT 1`,
        [compra.id_ocompra]
      );
      if (estados[0]?.estado === 'Completado') {
        await client.query(`INSERT INTO tb_estadooc (id_ocompra, estado) VALUES ($1, 'Enviado')`, [compra.id_ocompra]);
      }
    }
  }
  return obtenerCompraEnConexion(client, idCompra);
}

export async function anularCompra(idCompra, motivo) {
  try {
    return await transaction((client) => anularCompraEnTransaccion(client, idCompra, motivo));
  } catch (error) {
    throw mapearError(error);
  }
}
