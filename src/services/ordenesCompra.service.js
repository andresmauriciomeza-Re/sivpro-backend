import AppError from '../errors/AppError.js';
import { query, transaction } from '../config/db.js';
import { convertirCantidadCompra, calcularImporteLinea } from '../utils/compras.js';
import { redondearDosDecimales } from '../utils/insumos.js';
import { crearCompraEnTransaccion, anularCompraEnTransaccion } from './compras.service.js';
import { recalcularRecepcionEnTransaccion } from './recepcionOrden.service.js';

const TRANSICIONES = {
  Borrador: new Set(['Enviado', 'Completado', 'Anulado']),
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

async function validarProveedorActivo(client, idProveedor) {
  const { rows } = await client.query(
    'SELECT id_proveedor, nombre, estado FROM tb_proveedores WHERE id_proveedor = $1 FOR SHARE',
    [idProveedor]
  );
  if (!rows[0]) throw new AppError('Proveedor no encontrado.', 404);
  if (!rows[0].estado) throw new AppError('El proveedor está inactivo.', 409);
  return rows[0];
}

async function validarItemsOrdenCompra(client, items) {
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
      convertirCantidadCompra(1, item.medida, insumo.unidad_medida, insumo.nombre);
      resultado.push({ ...item, nombre: insumo.nombre });
      continue;
    }
    const { rows } = await client.query(
      `SELECT id_producto, nombre, tipo, unidad_compra
         FROM tb_productos
        WHERE id_producto = $1
        FOR SHARE`,
      [item.id_producto]
    );
    const producto = rows[0];
    if (!producto) throw new AppError('Producto no encontrado.', 404);
    if (producto.tipo !== 'Reventa') throw new AppError('Solo se pueden agregar productos Reventa a una orden de compra.', 400);
    const unidadCompra = producto.unidad_compra || 'und';
    if (item.medida !== unidadCompra) {
      throw new AppError(`La medida «${item.medida}» no coincide con la unidad de compra de «${producto.nombre}» (${unidadCompra}).`, 400);
    }
    resultado.push({ ...item, nombre: producto.nombre });
  }
  return resultado;
}

async function cargarOrdenCompleta(client, idOrdenCompra) {
  const { rows } = await client.query(
    `SELECT o.id_ocompra, o.id_proveedor, o.fecha, o.total,
            p.nombre AS proveedor_nombre,
            v.estado_actual, v.fecha_estado
       FROM tb_ordencompras o
       JOIN vw_ordencompras_estado v ON v.id_ocompra = o.id_ocompra
       JOIN tb_proveedores p ON p.id_proveedor = o.id_proveedor
      WHERE o.id_ocompra = $1`,
    [idOrdenCompra]
  );
  if (!rows[0]) throw new AppError('Orden de compra no encontrada.', 404);
  const orden = rows[0];
  const [historial, items, recepcion, compras] = await Promise.all([
    client.query(
      `SELECT estado, fecha_estado FROM tb_estadooc
        WHERE id_ocompra = $1
        ORDER BY fecha_estado, id_estadooc`,
      [idOrdenCompra]
    ),
    client.query(
      `SELECT d.id_dorcompra, d.id_insumo, d.id_producto,
              COALESCE(d.nombre, i.nombre, p.nombre) AS nombre,
              d.cantidad, d.medida, d.precio_unitario, d.iva, d.subtotal
         FROM tb_detalleordencompra d
         LEFT JOIN tb_insumo i ON i.id_insumo = d.id_insumo
         LEFT JOIN tb_productos p ON p.id_producto = d.id_producto
        WHERE d.id_ocompra = $1
        ORDER BY d.id_dorcompra`,
      [idOrdenCompra]
    ),
    client.query('SELECT recepcion FROM tb_recepcion_orden WHERE id_ocompra = $1', [idOrdenCompra]),
    client.query(
      `SELECT id_compra, n_factura, estado, total
         FROM tb_compras
        WHERE id_ocompra = $1
        ORDER BY fecha, id_compra`,
      [idOrdenCompra]
    ),
  ]);
  return {
    id_ocompra: Number(orden.id_ocompra),
    id_proveedor: Number(orden.id_proveedor),
    proveedor_nombre: orden.proveedor_nombre,
    fecha: orden.fecha,
    total: Number(orden.total),
    estado: orden.estado_actual,
    fecha_estado: orden.fecha_estado,
    historial_estados: historial.rows.map((row) => ({ estado: row.estado, fecha_estado: row.fecha_estado })),
    items: items.rows.map((row) => ({
      id_dorcompra: Number(row.id_dorcompra),
      id_insumo: row.id_insumo == null ? null : Number(row.id_insumo),
      id_producto: row.id_producto == null ? null : Number(row.id_producto),
      tipo_item: row.id_insumo != null ? 'insumo' : row.id_producto != null ? 'producto' : null,
      nombre: row.nombre,
      cantidad: Number(row.cantidad),
      medida: row.medida,
      precio_unitario: Number(row.precio_unitario),
      iva: Number(row.iva),
      subtotal: Number(row.subtotal),
    })),
    recepcion: recepcion.rows[0]?.recepcion ?? null,
    compras: compras.rows.map((row) => ({
      id_compra: Number(row.id_compra),
      n_factura: row.n_factura,
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
    const importe = calcularImporteLinea(item.cantidad, item.precio_unitario, item.iva, true);
    total += importe.subtotal;
    await client.query(
      `INSERT INTO tb_detalleordencompra
         (id_ocompra, id_insumo, id_producto, cantidad, medida,
          precio_unitario, iva, subtotal, nombre)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [idOrdenCompra, item.id_insumo, item.id_producto, item.cantidad, item.medida,
        item.precio_unitario, item.iva, importe.subtotal, item.nombre]
    );
  }
  return redondearDosDecimales(total);
}

export async function listarOrdenesCompra(filtros) {
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
  const { rows } = await query(
    `SELECT o.id_ocompra FROM tb_ordencompras o
       JOIN vw_ordencompras_estado v ON v.id_ocompra = o.id_ocompra
      ${condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : ''}
      ORDER BY o.fecha DESC, o.id_ocompra DESC`,
    valores
  );
  const ordenes = [];
  for (const row of rows) ordenes.push(await cargarOrdenCompleta(query, Number(row.id_ocompra)));
  return ordenes;
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
        `INSERT INTO tb_ordencompras (id_proveedor, total)
         VALUES ($1, $2)
         RETURNING id_ocompra`,
        [datos.id_proveedor, total]
      );
      const idOrdenCompra = Number(rows[0].id_ocompra);
      await insertarItems(client, idOrdenCompra, items);
      await client.query(
        'INSERT INTO tb_estadooc (id_ocompra, estado) VALUES ($1, $2)',
        [idOrdenCompra, datos.estado_inicial]
      );
      return await cargarOrdenCompleta(client, idOrdenCompra);
    });
  } catch (error) {
    throw mapearError(error);
  }
}

async function insertarItemsTempCalculo(client, items) {
  let total = 0;
  for (const item of items) total += calcularImporteLinea(item.cantidad, item.precio_unitario, item.iva, true).subtotal;
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
      if (datos.estado === 'Anulado') {
        const { rows: compras } = await client.query(
          `SELECT id_compra FROM tb_compras
            WHERE id_ocompra = $1 AND estado = 'Recibido'
            ORDER BY id_compra
            FOR UPDATE`,
          [idOrdenCompra]
        );
        for (const compra of compras) {
          await anularCompraEnTransaccion(client, Number(compra.id_compra), datos.motivo, { recalcularRecepcion: false });
        }
        if (compras.length) await recalcularRecepcionEnTransaccion(client, idOrdenCompra);
      }
      await client.query('INSERT INTO tb_estadooc (id_ocompra, estado) VALUES ($1, $2)', [idOrdenCompra, datos.estado]);
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
        `SELECT id_ocompra, id_proveedor FROM tb_ordencompras WHERE id_ocompra = $1 FOR UPDATE`,
        [idOrdenCompra]
      );
      if (!rows[0]) throw new AppError('Orden de compra no encontrada.', 404);
      const estado = await estadoActual(client, idOrdenCompra);
      if (estado !== 'Enviado') throw new AppError('Solo se pueden recibir órdenes de compra Enviado.', 409);

      const { recepcion: previa } = await recalcularRecepcionEnTransaccion(client, idOrdenCompra);
      const pendientes = new Map(previa.items.map((item) => [claveItem(item), item]));
      const recibidasEnPeticion = new Map();
      for (const item of datos.items) {
        const pendiente = pendientes.get(claveItem(item));
        if (!pendiente) throw new AppError('El ítem recibido no pertenece a la orden de compra; envíalo como no solicitado.', 400);
        const recibido = convertirCantidadCompra(item.cantidad, item.medida, pendiente.unidad, pendiente.nombre);
        const acumulado = (recibidasEnPeticion.get(claveItem(item)) || 0) + recibido;
        if (acumulado > pendiente.pendiente + 0.000001) {
          throw new AppError(`La cantidad recibida de «${pendiente.nombre}» supera lo pendiente en la orden.`, 400);
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
          debeProveedorActivo: false,
        }
      );
      const { completado } = await recalcularRecepcionEnTransaccion(client, idOrdenCompra);
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
