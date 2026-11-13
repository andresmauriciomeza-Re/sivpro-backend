import AppError from '../errors/AppError.js';
import { query, transaction } from '../config/db.js';
import {
  calcularImporteLinea,
  convertirABase,
  convertirCantidadCompra,
  resolverEmpaqueProducto,
  resolverModoIva,
} from '../utils/compras.js';
import { redondearDosDecimales } from '../utils/insumos.js';
import { crearCompraEnTransaccion } from './compras.service.js';
import { convertirItemABase } from './presentaciones.service.js';
import { recalcularRecepcionEnTransaccion } from './recepcionOrden.service.js';

const TRANSICIONES = {
  Borrador: new Set(['Enviado', 'Anulado']),
  Enviado: new Set(['Completado', 'Anulado']),
  Completado: new Set(),
  Anulado: new Set(),
};

function mapearError(error) {
  if (error instanceof AppError) return error;
  if (error?.code === '23505') return new AppError('Ya existe una orden de compra con esos datos.', 409);
  if (error?.code === '23503') return new AppError('El proveedor o alguno de los ítems relacionados no existe.', 400);
  if (error?.code === '23514' || error?.code === '23502' || error?.code === '22P02') {
    return new AppError('Los datos de la orden de compra no cumplen las reglas de la base de datos.', 400);
  }
  console.error('Error de base de datos en órdenes de compra:', error?.code, error?.constraint);
  console.error(error);
  return new AppError('No se pudo completar la operación de órdenes de compra.', 503);
}

function claveItem(item) {
  return item.id_insumo != null ? `i:${item.id_insumo}` : `p:${item.id_producto}`;
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

async function validarProveedorActivo(client, idProveedor) {
  const { rows } = await client.query(
    'SELECT id_proveedor, nombre, estado FROM tb_proveedores WHERE id_proveedor = $1 FOR SHARE',
    [idProveedor]
  );
  if (!rows[0]) throw new AppError('Proveedor no encontrado.', 404);
  if (!rows[0].estado) throw new AppError('El proveedor está inactivo.', 409);
  return rows[0];
}

export async function validarItemsOrdenCompra(client, items) {
  const resultado = [];
  for (const item of items) {
    if (item.id_insumo != null) {
      const { rows } = await client.query(
        `SELECT id_insumo, nombre, unidad_medida, estado
           FROM tb_insumo
          WHERE id_insumo = $1
          FOR SHARE`,
        [item.id_insumo]
      );
      const insumo = rows[0];
      if (!insumo) throw new AppError('Insumo no encontrado.', 404);
      if (!insumo.estado) throw new AppError(`El insumo «${insumo.nombre}» está inactivo.`, 409);
      const unidadInsumo = String(insumo.unidad_medida ?? '').trim();
      if (!item.medida || !String(item.medida).trim()) {
        throw new AppError(`La medida del insumo «${insumo.nombre}» es obligatoria.`, 400);
      }
      // Regla 2.2: se acepta la unidad del insumo (comparada sin distinguir
      // mayúsculas), una conversión directa (kg<->g, lt<->ml) y las
      // presentaciones de compra con su factor configurado o proporcionado.
      // convertirItemABase lanza 400 con mensaje en español si la medida no
      // es compatible o si falta el contenido de la presentación.
      const { unidadesBase, unidadBase } = await convertirItemABase(client, item, insumo);
      const medidaLimpia = String(item.medida).trim();
      const medidaNormalizada =
        medidaLimpia.toLowerCase() === unidadInsumo.toLowerCase() ? unidadInsumo : medidaLimpia;
      resultado.push({
        ...item,
        medida: medidaNormalizada,
        nombre: insumo.nombre,
        unidades_base: unidadesBase,
        unidad_base: unidadBase,
      });
      continue;
    }
    const { rows } = await client.query(
      `SELECT id_producto, nombre, tipo, unidad_compra, unidad_venta, unidades_por_empaque
         FROM tb_productos
        WHERE id_producto = $1
        FOR SHARE`,
      [item.id_producto]
    );
    const producto = rows[0];
    if (!producto) throw new AppError('Producto no encontrado.', 404);
    if (producto.tipo !== 'Reventa') throw new AppError('Solo se pueden agregar productos Reventa a una orden de compra.', 400);
    // Punto 6: además de la unidad de compra del catálogo se acepta otra
    // presentación (caja, paca, …) con su contenido o la unidad suelta.
    const { medida, empaque, delCatalogo } = resolverEmpaqueProducto(producto, item);
    resultado.push({
      ...item,
      medida,
      nombre: producto.nombre,
      // Sólo cuando la línea se aparta del catálogo se guarda lo que
      // representa en unidades del producto: la recepción lo usa para
      // recuperar el contenido de la presentación (unidades_base / cantidad)
      // y comparar lo recibido. Las líneas que coinciden con el catálogo
      // quedan exactamente como antes (sin unidades_base).
      ...(delCatalogo
        ? {}
        : {
          unidades_base: redondearDosDecimales(Number(item.cantidad) * empaque),
          unidad_base: String(producto.unidad_venta || 'und').trim(),
        }),
    });
  }
  return resultado;
}

async function cargarOrdenCompleta(client, idOrdenCompra, datosPrecargados = null) {
  const ejecutar = typeof client === 'function' ? client : client.query.bind(client);
  let orden;
  let historialRows;
  let itemsRows;
  let recepcionGuardada;
  let comprasRows;
  let detallesRecibidos;
  if (datosPrecargados) {
    orden = datosPrecargados.orden;
    historialRows = datosPrecargados.historial;
    itemsRows = datosPrecargados.items;
    recepcionGuardada = datosPrecargados.recepcion;
    comprasRows = datosPrecargados.compras;
    detallesRecibidos = datosPrecargados.detallesRecibidos;
  } else {
    const { rows } = await ejecutar(
      `SELECT o.id_ocompra, o.id_proveedor, to_char(o.fecha, 'YYYY-MM-DD') AS fecha, o.total,
              p.nombre AS proveedor_nombre, p.nit AS proveedor_nit,
              v.estado_actual, v.fecha_estado
         FROM tb_ordencompras o
         JOIN vw_ordencompras_estado v ON v.id_ocompra = o.id_ocompra
         JOIN tb_proveedores p ON p.id_proveedor = o.id_proveedor
        WHERE o.id_ocompra = $1`,
      [idOrdenCompra]
    );
    if (!rows[0]) throw new AppError('Orden de compra no encontrada.', 404);
    orden = rows[0];
    const historial = await ejecutar(
      `SELECT estado, fecha_estado, motivo
         FROM tb_estadooc
        WHERE id_ocompra = $1
        ORDER BY fecha_estado, id_estadooc`,
      [idOrdenCompra]
    );
    historialRows = historial.rows;
    const items = await ejecutar(
      `SELECT d.id_dorcompra, d.id_insumo, d.id_producto,
              COALESCE(d.nombre, i.nombre, p.nombre) AS nombre,
              d.cantidad, d.medida, d.precio_unitario, d.iva, d.subtotal,
              d.modo_iva, d.unidades_base, d.unidad_base
         FROM tb_detalleordencompra d
         LEFT JOIN tb_insumo i ON i.id_insumo = d.id_insumo
         LEFT JOIN tb_productos p ON p.id_producto = d.id_producto
        WHERE d.id_ocompra = $1
        ORDER BY d.id_dorcompra`,
      [idOrdenCompra]
    );
    itemsRows = items.rows;
    const recepcion = await ejecutar(
      'SELECT recepcion FROM tb_recepcion_orden WHERE id_ocompra = $1',
      [idOrdenCompra]
    );
    recepcionGuardada = recepcion.rows[0]?.recepcion ?? null;
    const compras = await ejecutar(
      `SELECT id_compra, n_factura, fecha, estado, total
         FROM tb_compras
        WHERE id_ocompra = $1
        ORDER BY fecha, id_compra`,
      [idOrdenCompra]
    );
    comprasRows = compras.rows;
    const idComprasRecibidas = comprasRows
      .filter((compra) => compra.estado === 'Recibido')
      .map((compra) => Number(compra.id_compra));
    const recibidos = idComprasRecibidas.length
      ? await ejecutar(
        `SELECT id_compra, id_insumo, id_producto, cantidad, medida,
                precio_unitario, iva, subtotal, es_no_solicitado, nombre,
                unidades_base
           FROM tb_detallecompra
          WHERE id_compra = ANY($1::integer[])
          ORDER BY id_dcompra`,
        [idComprasRecibidas]
      )
      : { rows: [] };
    detallesRecibidos = recibidos.rows;
  }

  const comprasRecibidas = comprasRows.filter((c) => c.estado === 'Recibido');
  const idComprasRecibidas = comprasRecibidas.map((c) => Number(c.id_compra));

  // Decisión 3A + A: calcular lo facturado y lo pendiente por insumo desde tb_compras (estado = 'Recibido')
  // y tb_detallecompra, excluyendo compras anuladas y líneas no solicitadas (es_no_solicitado = true).
  const recibidosPorItem = new Map();
  const extrasPorItem = new Map();
  let montoFacturado = 0;
  for (const detalle of detallesRecibidos) {
    const idInsumo = detalle.id_insumo == null ? null : Number(detalle.id_insumo);
    const idProducto = detalle.id_producto == null ? null : Number(detalle.id_producto);
    const key = idInsumo != null ? `i:${idInsumo}` : idProducto != null ? `p:${idProducto}` : `n:${detalle.nombre}`;
    if (detalle.es_no_solicitado) {
      const extraKey = `${key}:${detalle.medida}`;
      if (!extrasPorItem.has(extraKey)) {
        extrasPorItem.set(extraKey, {
          id_insumo: idInsumo,
          id_producto: idProducto,
          nombre: detalle.nombre,
          recibida: 0,
          unidad: detalle.medida,
        });
      }
      extrasPorItem.get(extraKey).recibida += Number(detalle.cantidad);
      continue;
    }
    montoFacturado += redondearDosDecimales(Number(detalle.cantidad) * Number(detalle.precio_unitario));
    if (!recibidosPorItem.has(key)) recibidosPorItem.set(key, []);
    recibidosPorItem.get(key).push(detalle);
  }

  let montoPorFacturar = 0;
  const itemsMapeados = itemsRows.map((row) => {
    const idInsumo = row.id_insumo == null ? null : Number(row.id_insumo);
    const idProducto = row.id_producto == null ? null : Number(row.id_producto);
    const cantidad = Number(row.cantidad);
    const precioUnitario = Number(row.precio_unitario);
    const iva = Number(row.iva);
    const key = idInsumo != null ? `i:${idInsumo}` : `p:${idProducto}`;
    const listaRecibidos = recibidosPorItem.get(key) || [];
    const facturado = listaRecibidos.length > 0;
    // Regla 2.2: cuando la línea de la orden tiene unidades_base, lo
    // facturado se acumula en la unidad base del insumo (así se comparan
    // compras hechas en distinta presentación, p. ej. 1 paca vs 20 kg) y
    // luego se vuelve a la unidad de la orden para mostrarlo. Las líneas
    // antiguas sin unidades_base conservan la conversión histórica.
    const enBase = row.unidades_base != null && row.unidad_base != null;
    let recibidaBase = 0;
    let recibidaEnUnidad = 0;
    for (const det of listaRecibidos) {
      if (enBase) {
        if (det.unidades_base != null) {
          recibidaBase += Number(det.unidades_base);
          continue;
        }
        try {
          recibidaBase += convertirABase({
            cantidad: det.cantidad,
            medida: det.medida,
            unidadBase: row.unidad_base,
            nombre: det.nombre || row.nombre,
          });
          continue;
        } catch {
          // Sin conversión posible: se usa el camino histórico de abajo.
        }
      }
      try {
        recibidaEnUnidad += convertirCantidadCompra(det.cantidad, det.medida, row.medida, det.nombre || row.nombre);
      } catch {
        recibidaEnUnidad += Number(det.cantidad);
      }
    }
    const ratio = enBase && Number(row.unidades_base) !== 0 ? cantidad / Number(row.unidades_base) : 1;
    const recibida = enBase ? recibidaBase * ratio + recibidaEnUnidad : recibidaEnUnidad;
    const cantidadRecibida = Number(recibida.toFixed(6));
    const cantidadPendiente = facturado ? 0 : Number(cantidad.toFixed(6));
    if (!facturado) {
      // Regla 2.1: el por facturar usa el modo de IVA de cada línea
      // (las líneas antiguas, sin modo, siguen con IVA incluido).
      montoPorFacturar += calcularImporteLinea(
        cantidad,
        precioUnitario,
        iva,
        resolverModoIva({ modo_iva: row.modo_iva }, true)
      ).subtotal;
    }
    return {
      id_dorcompra: Number(row.id_dorcompra),
      id_insumo: idInsumo,
      id_producto: idProducto,
      tipo_item: idInsumo != null ? 'insumo' : idProducto != null ? 'producto' : null,
      nombre: row.nombre,
      cantidad,
      medida: row.medida,
      precio_unitario: precioUnitario,
      iva,
      modo_iva: row.modo_iva ?? 'incluido',
      unidades_base: row.unidades_base == null ? null : Number(row.unidades_base),
      unidad_base: row.unidad_base ?? null,
      subtotal: Number(row.subtotal),
      cantidad_recibida: cantidadRecibida,
      cantidad_pendiente: cantidadPendiente,
      facturado,
    };
  });

  const recepcionCalculada = idComprasRecibidas.length
    ? {
        items: itemsMapeados.map((it) => ({
          id_insumo: it.id_insumo,
          id_producto: it.id_producto,
          nombre: it.nombre,
          solicitada: it.cantidad,
          recibida: it.cantidad_recibida,
          pendiente: it.cantidad_pendiente,
          facturado: it.facturado,
          unidad: it.medida,
          unidades_base: it.unidades_base,
          unidad_base: it.unidad_base,
        })),
        extras: [...extrasPorItem.values()].map((extra) => ({
          ...extra,
          recibida: Number(extra.recibida.toFixed(6)),
        })),
        compras: idComprasRecibidas,
        actualizado: recepcionGuardada?.actualizado ?? null,
      }
    : recepcionGuardada;

  const totalFacturas = redondearDosDecimales(
    comprasRecibidas.reduce((suma, c) => suma + Number(c.total), 0)
  );
  const ultimoAnulado = [...historialRows].reverse().find((h) => h.estado === 'Anulado');

  return {
    id_ocompra: Number(orden.id_ocompra),
    id_proveedor: Number(orden.id_proveedor),
    proveedor_nombre: orden.proveedor_nombre,
    proveedor_nit: orden.proveedor_nit,
    fecha: orden.fecha,
    total: Number(orden.total),
    facturado: redondearDosDecimales(montoFacturado),
    por_facturar: redondearDosDecimales(montoPorFacturar),
    total_facturas: totalFacturas,
    facturas: comprasRecibidas.map((c) => c.n_factura),
    estado: orden.estado_actual,
    fecha_estado: orden.fecha_estado,
    motivo_anulacion: ultimoAnulado?.motivo ?? null,
    historial_estados: historialRows.map((row) => ({
      estado: row.estado,
      fecha_estado: row.fecha_estado,
      motivo: row.motivo ?? null,
    })),
    items: itemsMapeados,
    recepcion: recepcionCalculada,
    compras: comprasRows.map((row) => ({
      id_compra: Number(row.id_compra),
      n_factura: row.n_factura,
      fecha: row.fecha,
      estado: row.estado,
      total: Number(row.total),
    })),
  };
}

async function estadoActual(client, idOrdenCompra) {
  const { rows } = await client.query(
    `SELECT estado FROM tb_estadooc
      WHERE id_ocompra = $1
      ORDER BY fecha_estado DESC, id_estadooc DESC
      LIMIT 1`,
    [idOrdenCompra]
  );
  if (!rows[0]) throw new AppError('La orden de compra no tiene estado registrado.', 409);
  return rows[0].estado;
}

async function insertarItems(client, idOrdenCompra, items) {
  let total = 0;
  for (const item of items) {
    // Regla 2.1: modo de IVA por ítem (por defecto 'incluido', como se
    // calculaba siempre en las órdenes de compra).
    const modoIva = resolverModoIva(item, undefined);
    const importe = calcularImporteLinea(item.cantidad, item.precio_unitario, item.iva, modoIva);
    total += importe.subtotal;
    await client.query(
      `INSERT INTO tb_detalleordencompra
         (id_ocompra, id_insumo, id_producto, cantidad, medida,
          precio_unitario, iva, modo_iva, subtotal, nombre,
          unidades_base, unidad_base)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [idOrdenCompra, item.id_insumo, item.id_producto, item.cantidad, item.medida,
        item.precio_unitario, item.iva, modoIva, importe.subtotal, item.nombre,
        item.unidades_base ?? null, item.unidad_base ?? null]
    );
  }
  return redondearDosDecimales(total);
}

async function cargarOrdenesCompletas(ordenes) {
  if (!ordenes.length) return [];
  const idsOrdenes = ordenes.map((orden) => Number(orden.id_ocompra));
  const [historial, items, recepciones, compras] = await Promise.all([
    query(
      `SELECT id_ocompra, estado, fecha_estado, motivo
         FROM tb_estadooc
        WHERE id_ocompra = ANY($1::integer[])
        ORDER BY id_ocompra, fecha_estado, id_estadooc`,
      [idsOrdenes]
    ),
    query(
      `SELECT d.id_ocompra, d.id_dorcompra, d.id_insumo, d.id_producto,
              COALESCE(d.nombre, i.nombre, p.nombre) AS nombre,
              d.cantidad, d.medida, d.precio_unitario, d.iva, d.subtotal,
              d.modo_iva, d.unidades_base, d.unidad_base
         FROM tb_detalleordencompra d
         LEFT JOIN tb_insumo i ON i.id_insumo = d.id_insumo
         LEFT JOIN tb_productos p ON p.id_producto = d.id_producto
        WHERE d.id_ocompra = ANY($1::integer[])
        ORDER BY d.id_ocompra, d.id_dorcompra`,
      [idsOrdenes]
    ),
    query(
      `SELECT id_ocompra, recepcion
         FROM tb_recepcion_orden
        WHERE id_ocompra = ANY($1::integer[])`,
      [idsOrdenes]
    ),
    query(
      `SELECT id_ocompra, id_compra, n_factura, fecha, estado, total
         FROM tb_compras
        WHERE id_ocompra = ANY($1::integer[])
        ORDER BY id_ocompra, fecha, id_compra`,
      [idsOrdenes]
    ),
  ]);
  const historialPorOrden = agruparFilasPorId(historial.rows, 'id_ocompra');
  const itemsPorOrden = agruparFilasPorId(items.rows, 'id_ocompra');
  const recepcionPorOrden = new Map(
    recepciones.rows.map((row) => [String(row.id_ocompra), row.recepcion])
  );
  const comprasPorOrden = agruparFilasPorId(compras.rows, 'id_ocompra');
  const idsComprasRecibidas = compras.rows
    .filter((compra) => compra.estado === 'Recibido')
    .map((compra) => Number(compra.id_compra));
  let detallesRecibidos = [];
  if (idsComprasRecibidas.length) {
    const resultado = await query(
      `SELECT c.id_ocompra AS _id_ocompra,
              d.id_compra, d.id_insumo, d.id_producto, d.cantidad, d.medida,
              d.precio_unitario, d.iva, d.subtotal, d.es_no_solicitado, d.nombre,
              d.unidades_base
         FROM tb_detallecompra d
         JOIN tb_compras c ON c.id_compra = d.id_compra
        WHERE c.id_ocompra = ANY($1::integer[])
          AND c.estado = 'Recibido'
        ORDER BY d.id_dcompra`,
      [idsOrdenes]
    );
    detallesRecibidos = resultado.rows;
  }
  const detallesPorOrden = agruparFilasPorId(detallesRecibidos, '_id_ocompra');

  return Promise.all(ordenes.map((orden) => {
    const id = String(orden.id_ocompra);
    return cargarOrdenCompleta(query, orden.id_ocompra, {
      orden,
      historial: historialPorOrden.get(id) ?? [],
      items: itemsPorOrden.get(id) ?? [],
      recepcion: recepcionPorOrden.get(id) ?? null,
      compras: comprasPorOrden.get(id) ?? [],
      detallesRecibidos: detallesPorOrden.get(id) ?? [],
    });
  }));
}

export async function listarOrdenesCompra(filtros = {}) {
  const condiciones = [];
  const valores = [];
  if (filtros.estado !== undefined) {
    valores.push(filtros.estado);
    condiciones.push(`v.estado_actual = $${valores.length}`);
  }
  if (filtros.id_proveedor !== undefined) {
    valores.push(filtros.id_proveedor);
    condiciones.push(`o.id_proveedor = $${valores.length}`);
  }
  if (filtros.desde !== undefined) {
    valores.push(filtros.desde);
    condiciones.push(`o.fecha::date >= $${valores.length}::date`);
  }
  if (filtros.hasta !== undefined) {
    valores.push(filtros.hasta);
    condiciones.push(`o.fecha::date <= $${valores.length}::date`);
  }
  if (filtros.busqueda !== undefined) {
    valores.push(`%${filtros.busqueda}%`);
    const param = `$${valores.length}`;
    condiciones.push(
      `(p.nombre ILIKE ${param} OR p.nit ILIKE ${param} OR CAST(o.id_ocompra AS TEXT) ILIKE ${param} OR ('OC-' || LPAD(CAST(o.id_ocompra AS TEXT), 3, '0')) ILIKE ${param})`
    );
  }

  const whereSql = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
  const baseFromSql = `FROM tb_ordencompras o
       JOIN vw_ordencompras_estado v ON v.id_ocompra = o.id_ocompra
       JOIN tb_proveedores p ON p.id_proveedor = o.id_proveedor
      ${whereSql}`;

  if (filtros.paginar) {
    const { rows: conteoRows } = await query(
      `SELECT COUNT(*)::integer AS total ${baseFromSql}`,
      valores
    );
    const total = Number(conteoRows[0]?.total ?? 0);
    const page = Number(filtros.page ?? 1);
    const limit = Number(filtros.limit ?? 50);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const offset = (page - 1) * limit;

    const valoresPagina = [...valores, limit, offset];
    const { rows } = await query(
      `SELECT o.id_ocompra, o.id_proveedor, to_char(o.fecha, 'YYYY-MM-DD') AS fecha, o.total,
              p.nombre AS proveedor_nombre, p.nit AS proveedor_nit,
              v.estado_actual, v.fecha_estado
         ${baseFromSql}
        ORDER BY o.fecha DESC, o.id_ocompra DESC
        LIMIT $${valoresPagina.length - 1} OFFSET $${valoresPagina.length}`,
      valoresPagina
    );
    const ordenes = await cargarOrdenesCompletas(rows);
    return {
      data: ordenes,
      total,
      page,
      limit,
      totalPages,
    };
  }

  const { rows } = await query(
    `SELECT o.id_ocompra, o.id_proveedor, to_char(o.fecha, 'YYYY-MM-DD') AS fecha, o.total,
            p.nombre AS proveedor_nombre, p.nit AS proveedor_nit,
            v.estado_actual, v.fecha_estado
       ${baseFromSql}
      ORDER BY o.fecha DESC, o.id_ocompra DESC`,
    valores
  );
  return cargarOrdenesCompletas(rows);
}

export async function obtenerOrdenCompra(idOrdenCompra) {
  return cargarOrdenCompleta(query, idOrdenCompra);
}

export async function crearOrdenCompra(datos) {
  try {
    return await transaction(async (client) => {
      await validarProveedorActivo(client, datos.id_proveedor);
      const items = await validarItemsOrdenCompra(client, datos.items);
      const total = await insertarItemsTempCalculo(client, items);
      const { rows } = await client.query(
        `INSERT INTO tb_ordencompras (id_proveedor, total, fecha)
         VALUES ($1, $2, NOW() AT TIME ZONE 'America/Bogota')
         RETURNING id_ocompra`,
        [datos.id_proveedor, total]
      );
      const idOrdenCompra = Number(rows[0].id_ocompra);
      await insertarItems(client, idOrdenCompra, items);
      await client.query(
        'INSERT INTO tb_estadooc (id_ocompra, estado) VALUES ($1, $2)',
        [idOrdenCompra, 'Borrador']
      );
      return await cargarOrdenCompleta(client, idOrdenCompra);
    });
  } catch (error) {
    throw mapearError(error);
  }
}

async function insertarItemsTempCalculo(client, items) {
  let total = 0;
  for (const item of items) {
    total += calcularImporteLinea(
      item.cantidad,
      item.precio_unitario,
      item.iva,
      resolverModoIva(item, undefined)
    ).subtotal;
  }
  return redondearDosDecimales(total);
}

export async function actualizarOrdenCompra(idOrdenCompra, datos) {
  try {
    return await transaction(async (client) => {
      const { rows } = await client.query('SELECT id_ocompra FROM tb_ordencompras WHERE id_ocompra = $1 FOR UPDATE', [idOrdenCompra]);
      if (!rows[0]) throw new AppError('Orden de compra no encontrada.', 404);
      if (await estadoActual(client, idOrdenCompra) !== 'Borrador') throw new AppError('Solo se pueden editar órdenes de compra en Borrador.', 409);
      await validarProveedorActivo(client, datos.id_proveedor);
      const items = await validarItemsOrdenCompra(client, datos.items);
      const total = await insertarItemsTempCalculo(client, items);
      await client.query('DELETE FROM tb_detalleordencompra WHERE id_ocompra = $1', [idOrdenCompra]);
      await insertarItems(client, idOrdenCompra, items);
      await client.query('UPDATE tb_ordencompras SET id_proveedor = $2, total = $3 WHERE id_ocompra = $1', [idOrdenCompra, datos.id_proveedor, total]);
      return await cargarOrdenCompleta(client, idOrdenCompra);
    });
  } catch (error) {
    throw mapearError(error);
  }
}

export async function cambiarEstadoOrdenCompra(idOrdenCompra, datos) {
  try {
    return await transaction(async (client) => {
      const { rows } = await client.query('SELECT id_ocompra FROM tb_ordencompras WHERE id_ocompra = $1 FOR UPDATE', [idOrdenCompra]);
      if (!rows[0]) throw new AppError('Orden de compra no encontrada.', 404);
      const estado = await estadoActual(client, idOrdenCompra);
      if (!TRANSICIONES[estado]?.has(datos.estado)) throw new AppError(`Transición no permitida: ${estado} → ${datos.estado}.`, 409);
      // Decisión D1: se permite anular una orden en Enviado aunque tenga compras Recibido;
      // se guarda el motivo en tb_estadooc y NO se tocan las compras ni el stock.
      await client.query(
        'INSERT INTO tb_estadooc (id_ocompra, estado, motivo) VALUES ($1, $2, $3)',
        [idOrdenCompra, datos.estado, datos.estado === 'Anulado' ? datos.motivo : null]
      );
      return await cargarOrdenCompleta(client, idOrdenCompra);
    });
  } catch (error) {
    throw mapearError(error);
  }
}

export async function recibirOrdenCompra(idOrdenCompra, datos) {
  try {
    return await transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT id_ocompra, id_proveedor
           FROM tb_ordencompras
          WHERE id_ocompra = $1
          FOR UPDATE`,
        [idOrdenCompra]
      );
      if (!rows[0]) throw new AppError('Orden de compra no encontrada.', 404);
      const estado = await estadoActual(client, idOrdenCompra);
      if (estado !== 'Enviado') throw new AppError('Solo se pueden recibir órdenes de compra Enviado.', 409);

      const { recepcion: previa } = await recalcularRecepcionEnTransaccion(client, idOrdenCompra, { bloquear: true });
      const pendientes = new Map(previa.items.map((item) => [claveItem(item), item]));

      for (const extra of datos.items_no_solicitados) {
        if (extra.id_insumo != null || extra.id_producto != null) {
          const enOrden = pendientes.get(claveItem(extra));
          if (enOrden) {
            throw new AppError(
              `El ítem «${enOrden.nombre}» pertenece a la orden de compra; debe incluirse como ítem solicitado.`,
              409
            );
          }
        }
      }

      const recibidasEnPeticion = new Map();
      for (const item of datos.items) {
        const pendiente = pendientes.get(claveItem(item));
        if (!pendiente) throw new AppError('El ítem recibido no pertenece a la orden de compra; envíalo como no solicitado.', 400);
        if (pendiente.facturado) {
          throw new AppError(
            `El ítem «${pendiente.nombre}» ya fue facturado en una recepción anterior de esta orden.`,
            409
          );
        }
        // Regla 2.2: si la línea de la orden tiene unidades_base, la
        // comparación se hace en la unidad base del insumo (permite recibir
        // una presentación distinta de la pedida, p. ej. 20 kg contra
        // 1 paca). Si no (líneas antiguas), se conserva la conversión
        // histórica a la unidad de la orden.
        let recibido;
        let limite;
        if (item.id_insumo != null && pendiente.unidades_base != null && pendiente.unidad_base != null) {
          const { rows: insumos } = await client.query(
            `SELECT id_insumo, nombre, unidad_medida, estado
               FROM tb_insumo
              WHERE id_insumo = $1`,
            [item.id_insumo]
          );
          const insumo = insumos[0];
          if (!insumo) throw new AppError('Insumo no encontrado.', 404);
          recibido = (await convertirItemABase(client, item, insumo)).unidadesBase;
          limite = Number(pendiente.unidades_base);
        } else {
          recibido = convertirCantidadCompra(item.cantidad, item.medida, pendiente.unidad, pendiente.nombre);
          limite = Number(pendiente.solicitada);
        }
        const acumulado = (recibidasEnPeticion.get(claveItem(item)) || 0) + recibido;
        if (acumulado > limite + 0.000001) {
          throw new AppError(`La cantidad recibida de «${pendiente.nombre}» supera lo pedido en la orden.`, 400);
        }
        recibidasEnPeticion.set(claveItem(item), acumulado);
      }

      const compra = await crearCompraEnTransaccion(
        client,
        {
          n_factura: datos.n_factura,
          fecha: datos.fecha,
          iva_incluido: datos.iva_incluido,
          items: datos.items,
        },
        {
          id_ocompra: idOrdenCompra,
          id_proveedor: Number(rows[0].id_proveedor),
          itemsNoSolicitados: datos.items_no_solicitados,
          debeProveedorActivo: true,
        }
      );
      const { completado } = await recalcularRecepcionEnTransaccion(client, idOrdenCompra, { bloquear: true });
      if (completado) {
        await client.query('INSERT INTO tb_estadooc (id_ocompra, estado) VALUES ($1, \'Completado\')', [idOrdenCompra]);
      }
      const orden = await cargarOrdenCompleta(client, idOrdenCompra);
      return { compra, estado_orden: orden.estado, recepcion: orden.recepcion };
    });
  } catch (error) {
    throw mapearError(error);
  }
}
