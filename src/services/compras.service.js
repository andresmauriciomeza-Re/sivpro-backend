import AppError from '../errors/AppError.js';
import { query, transaction } from '../config/db.js';
import { registrarEntradaCompraEnTransaccion, revertirCompraEnTransaccion } from './productos.service.js';
import { recalcularRecepcionEnTransaccion } from './recepcionOrden.service.js';
import { convertirItemABase } from './presentaciones.service.js';
import {
  calcularImporteLinea,
  convertirCantidadCompra,
  derivarIvaIncluidoGlobal,
  resolverEmpaqueProducto,
  resolverModoIva,
} from '../utils/compras.js';
import {
  compararNombreInsumo,
  normalizarNombreInsumo,
  redondearDosDecimales,
  UNIDADES_BASE_INSUMO,
  UNIDADES_BASE_LEGADAS,
} from '../utils/insumos.js';

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

export function agruparFilasPorId(rows, campoId) {
  const agrupadas = new Map();
  for (const row of rows) {
    const id = String(row[campoId]);
    if (!agrupadas.has(id)) agrupadas.set(id, []);
    agrupadas.get(id).push(row);
  }
  return agrupadas;
}

function mapearDetalleCompra(detalle) {
  return {
    ...detalle,
    id_dcompra: Number(detalle.id_dcompra),
    id_compra: Number(detalle.id_compra),
    id_insumo: detalle.id_insumo == null ? null : Number(detalle.id_insumo),
    id_producto: detalle.id_producto == null ? null : Number(detalle.id_producto),
    cantidad: Number(detalle.cantidad),
    precio_unitario: Number(detalle.precio_unitario),
    iva: Number(detalle.iva),
    // Regla 2.1: modo de IVA de la línea (las líneas antiguas quedan 'incluido').
    modo_iva: detalle.modo_iva ?? 'incluido',
    base_sin_iva: Number(detalle.base_sin_iva),
    monto_iva: Number(detalle.monto_iva),
    subtotal: Number(detalle.subtotal),
    // Regla 2.2: cantidad en la unidad base del insumo (NULL en productos y
    // en líneas antiguas cuya conversión no era conocible).
    unidades_base: detalle.unidades_base == null ? null : Number(detalle.unidades_base),
    unidad_base: detalle.unidad_base ?? null,
  };
}

function mapearCompra(row, detalles) {
  const compra = { ...row };
  for (const campo of ['id_compra', 'id_ocompra', 'id_proveedor']) {
    compra[campo] = compra[campo] == null ? null : Number(compra[campo]);
  }
  for (const campo of ['subtotal_sin_iva', 'total_iva', 'total']) compra[campo] = Number(compra[campo]);
  compra.detalle = detalles.map(mapearDetalleCompra);
  return compra;
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

/**
 * Fase C (anulación de compra): ¿el insumo está siendo usado por una orden de
 * producción activa?
 *
 * Se considera "en uso" cualquier orden **Pendiente, En proceso o Completada**;
 * sólo la Cancelada libera al insumo (si más adelante hay que bloquear sólo
 * "En proceso"/"Completada", basta con quitar 'Pendiente' del IN).
 *
 * Dos caminos, porque una línea puede depender del insumo de dos maneras:
 *   1. la ficha técnica con la que se creó la línea (`d.id_ft`) lo incluye en
 *      `tb_insumo_ficha_tecnica` (índice (id_ft, id_insumo) de la migración 011);
 *   2. el snapshot de consumo de la línea (`insumos_consumidos.insumos[]`) lo
 *      menciona: cubre líneas sin ficha y recetas modificadas DESPUÉS de crear
 *      la orden (un insumo quitado de la receta ya no aparecería en el camino 1).
 *
 * Devuelve `{ id_orden_produccion, estado }` de la orden más reciente, o `null`.
 */
export async function buscarOrdenProduccionConInsumo(client, idInsumo) {
  const { rows } = await client.query(
    `SELECT o.id_orden_produccion, o.estado
       FROM tb_orden_produccion o
       JOIN tb_detalle_orden_produccion d
         ON d.id_orden_produccion = o.id_orden_produccion
      WHERE o.estado IN ('Pendiente', 'En proceso', 'Completada')
        AND (
          EXISTS (
            SELECT 1
              FROM tb_insumo_ficha_tecnica ift
             WHERE ift.id_ft = d.id_ft
               AND ift.id_insumo = $1
          )
          OR (
            jsonb_typeof(d.insumos_consumidos) = 'object'
            AND d.insumos_consumidos @> jsonb_build_object(
                  'insumos',
                  jsonb_build_array(jsonb_build_object('id_insumo', $1::int))
                )
          )
        )
      ORDER BY o.id_orden_produccion DESC
      LIMIT 1`,
    [idInsumo]
  );
  return rows[0] ?? null;
}

/**
 * Mensaje exacto del 409 que recibe el frontend (`toast.error` con el 409
 * conserva el mensaje del servidor). Se exporta para poder testearlo sin BD.
 */
export function mensajeInsumoEnOrdenProduccion(nombreInsumo, orden) {
  return `No se puede anular: el insumo «${nombreInsumo}» está siendo utilizado en la orden de producción N° ${orden.id_orden_produccion} (${orden.estado}).`;
}

async function obtenerCompraEnConexion(client, idCompra) {
  const ejecutar = typeof client === 'function' ? client : client.query.bind(client);
  const { rows } = await ejecutar(
    `SELECT c.id_compra, c.id_ocompra, c.id_proveedor, c.n_factura, c.fecha,
            c.iva_incluido, c.subtotal_sin_iva, c.total_iva, c.total, c.estado,
            c.motivo_anulacion, c.fecha_anulacion,
            p.nombre AS proveedor_nombre, p.nit AS proveedor_nit
       FROM tb_compras c
       LEFT JOIN tb_proveedores p ON p.id_proveedor = c.id_proveedor
      WHERE c.id_compra = $1`,
    [idCompra]
  );
  if (!rows[0]) throw new AppError('Compra no encontrada.', 404);
  const { rows: detalles } = await ejecutar(
    `SELECT id_dcompra, id_compra, id_insumo, id_producto, cantidad, medida,
            precio_unitario, iva, modo_iva, base_sin_iva, monto_iva, subtotal,
            es_no_solicitado, nombre, unidades_base, unidad_base
       FROM tb_detallecompra
      WHERE id_compra = $1
      ORDER BY id_dcompra`,
    [idCompra]
  );
  return mapearCompra(rows[0], detalles);
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

  // Regla 2.2: el ítem puede venir en presentación de compra (paca, sixpack,
  // ...). Como el insumo no existe todavía, la petición debe indicar la
  // unidad base y el factor; el insumo se crea con la unidad base y el stock
  // queda convertido a unidades base. Sin factor, las presentaciones legadas
  // (paq, caja, bolsa) conservan el comportamiento histórico.
  const medida = String(item.medida).trim();
  const esUnidadBase = UNIDADES_BASE_INSUMO.includes(medida);
  const esUnidadLegada = UNIDADES_BASE_LEGADAS.includes(medida);
  const factorIndicado = item.factor_presentacion != null && item.factor_presentacion !== '';
  let unidadMedida = medida;
  let unidadesBase = unidades;
  let presentacion = null;
  let factor = null;

  if (!esUnidadBase && (!esUnidadLegada || factorIndicado)) {
    unidadMedida = String(item.unidad_base ?? '').trim();
    factor = Number(item.factor_presentacion);
    if (!UNIDADES_BASE_INSUMO.includes(unidadMedida) || !Number.isFinite(factor) || factor <= 0) {
      throw new AppError(
        `El insumo nuevo «${nombre}» se recibió en presentación «${medida}»: indica la unidad base (${UNIDADES_BASE_INSUMO.join(', ')}) y cuántas unidades base trae cada ${medida} (campos unidad_base y factor_presentacion).`,
        400
      );
    }
    presentacion = medida;
    unidadesBase = unidades * factor;
  }

  const costoUnitario = redondearDosDecimales(importe.subtotal / unidadesBase);

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
      unidadMedida,
      unidadesBase,
      stockMinimo,
      costoUnitario,
      item.iva,
    ]
  );
  const idInsumo = Number(rows[0].id_insumo);

  if (presentacion) {
    await client.query(
      `INSERT INTO tb_insumo_presentacion (id_insumo, presentacion, unidades_base, estado)
       VALUES ($1, $2, $3, TRUE)
       ON CONFLICT (id_insumo, presentacion)
       DO UPDATE SET unidades_base = EXCLUDED.unidades_base,
                     estado = TRUE`,
      [idInsumo, presentacion, factor]
    );
  }

  return {
    id_insumo: idInsumo,
    nombre: rows[0].nombre,
    unidades_base: unidadesBase,
    unidad_base: unidadMedida,
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
  // Regla 2.2: la cantidad entra al inventario en la unidad base del insumo
  // (medida directa o presentación con su factor configurado).
  const { unidadesBase, unidadBase } = await convertirItemABase(client, item, insumo);
  if (unidadesBase <= 0) throw new AppError('La cantidad convertida del insumo no es válida.', 400);
  const costoUnitario = redondearDosDecimales(importe.subtotal / unidadesBase);
  await client.query(
    `UPDATE tb_insumo
        SET stock_actual = stock_actual + $2::numeric, costo_unitario = $3, iva = $4
      WHERE id_insumo = $1`,
    [item.id_insumo, unidadesBase, costoUnitario, iva]
  );
  return {
    nombre: insumo.nombre,
    cantidad: item.cantidad,
    medida: item.medida,
    unidades_base: unidadesBase,
    unidad_base: unidadBase,
  };
}

async function aplicarStockProducto(client, item, importe, iva) {
  const { rows } = await client.query(
    `SELECT id_producto, nombre, tipo, unidad_compra, unidad_venta, unidades_por_empaque
       FROM tb_productos
      WHERE id_producto = $1
      FOR UPDATE`,
    [item.id_producto]
  );
  const producto = rows[0];
  if (!producto) throw new AppError('Producto no encontrado.', 404);
  if (producto.tipo !== 'Reventa') throw new AppError('Solo los productos Reventa admiten compras.', 400);
  // Punto 6: la línea puede comprarse en cualquier presentación (caja, paca,
  // paq, bolsa, sixpack) con su CONTENIDO (factor_presentacion), que manda
  // sobre las unidades por empaque del catálogo — igual que ya se hacía con
  // los insumos (convertirItemABase) —, o en la unidad suelta del producto.
  // Sin factor en la línea se conserva el cálculo histórico del catálogo.
  const { empaque } = resolverEmpaqueProducto(producto, item);
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
    ultimo_iva_compra:  iva,
    // Punto C1: el monto unitario tal cual lo digitó el usuario en la línea
    // (por presentación, SIN dividir por IVA). Es lo que se precarga en
    // "Monto unitario" la próxima vez que se elige el producto en Nueva
    // Compra, Orden de Compra o Recepción — sin convertirlo.
    ultimo_monto_digitado: item.precio_unitario,
  });
  return {
    nombre: resultado.nombre,
    cantidad: item.cantidad,
    medida: item.medida,
    unidades_stock: unidades,
    // Punto 6: lo que entró a inventario viaja en la línea (unidad real del
    // producto) para poder anular exactamente lo mismo y mostrar
    // "caja × 6 und" en el detalle de la compra.
    unidades_base: unidades,
    unidad_base: producto.unidad_venta?.trim() || 'und',
  };
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

  // Regla 2.1: cada línea se calcula con su propio modo de IVA; el IVA
  // global de la petición solo actúa como fallback de las líneas antiguas
  // que no traen modo.
  const importes = items.map((item) =>
    calcularImporteLinea(item.cantidad, item.precio_unitario, item.iva, resolverModoIva(item, datos.iva_incluido))
  );
  const ivaIncluidoGlobal = derivarIvaIncluidoGlobal(items, datos.iva_incluido);
  const subtotalSinIva = redondearDosDecimales(importes.reduce((suma, importe) => suma + importe.base_sin_iva, 0));
  const totalIva = redondearDosDecimales(importes.reduce((suma, importe) => suma + importe.monto_iva, 0));
  const total = redondearDosDecimales(importes.reduce((suma, importe) => suma + importe.subtotal, 0));
  const { rows: compras } = await client.query(
    `INSERT INTO tb_compras
       (id_ocompra, id_proveedor, n_factura, fecha, iva_incluido,
        subtotal_sin_iva, total_iva, total, estado)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Recibido')
     RETURNING id_compra`,
    [id_ocompra, id_proveedor, datos.n_factura.trim(), datos.fecha, ivaIncluidoGlobal, subtotalSinIva, totalIva, total]
  );
  const idCompra = Number(compras[0].id_compra);

  for (let indice = 0; indice < items.length; indice += 1) {
    const item = items[indice];
    const importe = importes[indice];
    const modoIva = resolverModoIva(item, datos.iva_incluido);
    let idInsumoDetalle = item.id_insumo;
    let nombre;
    let unidadesBase = null;
    let unidadBase = null;
    if (item.es_no_solicitado && item.id_insumo == null && item.id_producto == null) {
      const creado = await crearInsumoNoSolicitadoEnTransaccion(client, item, importe);
      idInsumoDetalle = creado.id_insumo;
      nombre = creado.nombre;
      unidadesBase = creado.unidades_base;
      unidadBase = creado.unidad_base;
    } else if (item.id_insumo != null) {
      const aplicado = await aplicarStockInsumo(client, item, importe, item.iva);
      nombre = aplicado.nombre;
      unidadesBase = aplicado.unidades_base;
      unidadBase = aplicado.unidad_base;
    } else {
      const aplicado = await aplicarStockProducto(client, item, importe, item.iva);
      nombre = aplicado.nombre;
      // Punto 6: las líneas de producto también guardan lo que entró a
      // inventario (antes quedaba NULL y la anulación tenía que adivinarlo).
      unidadesBase = aplicado.unidades_base;
      unidadBase = aplicado.unidad_base;
    }
    await client.query(
      `INSERT INTO tb_detallecompra
         (id_compra, id_insumo, id_producto, cantidad, medida, precio_unitario,
          iva, modo_iva, base_sin_iva, monto_iva, subtotal, es_no_solicitado,
          nombre, unidades_base, unidad_base)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [idCompra, idInsumoDetalle, item.id_producto, item.cantidad, item.medida, item.precio_unitario,
        item.iva, modoIva, importe.base_sin_iva, importe.monto_iva, importe.subtotal, item.es_no_solicitado,
        nombre, unidadesBase, unidadBase]
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
    `SELECT c.id_compra, c.id_ocompra, c.id_proveedor, c.n_factura, c.fecha,
            c.iva_incluido, c.subtotal_sin_iva, c.total_iva, c.total, c.estado,
            c.motivo_anulacion, c.fecha_anulacion,
            p.nombre AS proveedor_nombre, p.nit AS proveedor_nit
       FROM tb_compras c
       LEFT JOIN tb_proveedores p ON p.id_proveedor = c.id_proveedor
      ${condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : ''}
      ORDER BY c.fecha DESC, c.id_compra DESC`,
    valores
  );
  if (!rows.length) return [];
  const idsCompras = rows.map((row) => Number(row.id_compra));
  const { rows: detalles } = await query(
    `SELECT id_dcompra, id_compra, id_insumo, id_producto, cantidad, medida,
            precio_unitario, iva, modo_iva, base_sin_iva, monto_iva, subtotal,
            es_no_solicitado, nombre, unidades_base, unidad_base
       FROM tb_detallecompra
      WHERE id_compra = ANY($1::integer[])
      ORDER BY id_compra, id_dcompra`,
    [idsCompras]
  );
  const detallesPorCompra = agruparFilasPorId(detalles, 'id_compra');
  return rows.map((row) =>
    mapearCompra(row, detallesPorCompra.get(String(row.id_compra)) ?? [])
  );
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
    `SELECT id_insumo, id_producto, cantidad, medida, nombre, unidades_base
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
      // Fase C: si el insumo ya forma parte de una orden de producción activa,
      // NO se devuelve su stock (aunque alcance). El 409 aborta la transacción
      // completa: ni estado, ni stock, ni la anulación en cascada de la OC.
      const ordenEnUso = await buscarOrdenProduccionConInsumo(client, detalle.id_insumo);
      if (ordenEnUso) {
        throw new AppError(mensajeInsumoEnOrdenProduccion(insumo.nombre, ordenEnUso), 409);
      }
      // Regla 2.2: se devuelve exactamente lo que entró (unidades_base
      // guardadas al recibir, en la unidad base del insumo). En líneas
      // antiguas sin ese dato se conserva la conversión histórica.
      const unidades = detalle.unidades_base != null
        ? Number(detalle.unidades_base)
        : convertirCantidadCompra(detalle.cantidad, detalle.medida, insumo.unidad_medida, insumo.nombre);
      const { rowCount } = await client.query(
        `UPDATE tb_insumo SET         stock_actual = stock_actual - $2::numeric
                  WHERE id_insumo = $1 AND stock_actual >= $2::numeric`,
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
      // Punto 6: si la línea guardó lo que entró (unidades_base), se devuelve
      // EXACTAMENTE eso — igual que ya se hacía con los insumos — aunque el
      // Contenido de la línea haya sido distinto del catálogo. Las líneas
      // antiguas sin ese dato conservan la conversión histórica.
      let unidades;
      if (detalle.unidades_base != null) {
        unidades = Number(detalle.unidades_base);
      } else {
        const empaque = detalle.medida === 'und' ? 1 : Number(producto.unidades_por_empaque);
        if (!Number.isFinite(empaque) || empaque < 1) throw new AppError(`No se puede anular: no se conoce el empaque de «${producto.nombre}».`, 409);
        unidades = Number(detalle.cantidad) * empaque;
      }
      try {
        await revertirCompraEnTransaccion(client, detalle.id_producto, { unidades });
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
    // Conteo de TODAS las compras de la orden (cualquier estado).
    const { rows: conteo } = await client.query(
      `SELECT COUNT(*)::int AS total FROM tb_compras WHERE id_ocompra = $1`,
      [compra.id_ocompra]
    );
    const totalCompras = Number(conteo[0]?.total ?? 0);

    if (totalCompras === 1) {
      // Compra única: la orden también pasa a Anulado en esta misma transacción.
      const { rows: estados } = await client.query(
        `SELECT estado FROM tb_estadooc WHERE id_ocompra = $1 ORDER BY fecha_estado DESC, id_estadooc DESC LIMIT 1`,
        [compra.id_ocompra]
      );
      if (estados[0]?.estado !== 'Anulado') {
        await client.query(
          `INSERT INTO tb_estadooc (id_ocompra, estado, motivo) VALUES ($1, 'Anulado', $2)`,
          [compra.id_ocompra, motivo]
        );
      }
      // Aquí NO se revierte Completado → Enviado.
    } else if (!completado) {
      // Más de una compra: comportamiento ACTUAL, sin cambios.
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
