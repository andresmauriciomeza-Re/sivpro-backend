import AppError from '../errors/AppError.js';
import { fechaHoraBogota } from '../utils/produccion.js';
import { UNIDADES_COMPRA } from '../utils/compras.js';

function numero(valor, campo) {
  if (valor === undefined || valor === null || typeof valor === 'boolean' || (typeof valor === 'string' && !valor.trim())) {
    throw new AppError(`El campo ${campo} debe ser un número.`, 400);
  }
  const resultado = Number(valor);
  if (!Number.isFinite(resultado)) throw new AppError(`El campo ${campo} debe ser un número.`, 400);
  return resultado;
}

function enteroPositivo(valor, campo) {
  const resultado = numero(valor, campo);
  if (!Number.isSafeInteger(resultado) || resultado <= 0) throw new AppError(`El campo ${campo} debe ser un entero mayor que cero.`, 400);
  return resultado;
}

function validarNumeroFactura(valor) {
  if (typeof valor !== 'string' || !valor.trim() || valor.trim().length > 30) {
    throw new AppError('El número de factura es obligatorio y no puede superar 30 caracteres.', 400);
  }
  return valor.trim();
}

function fechaNoFutura(valor) {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    throw new AppError('La fecha debe tener formato YYYY-MM-DD.', 400);
  }
  const [anio, mes, dia] = valor.split('-').map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  if (fecha.toISOString().slice(0, 10) !== valor) throw new AppError('La fecha no es válida.', 400);
  if (valor > fechaHoraBogota().fecha) throw new AppError('La fecha no puede ser futura.', 400);
  return valor;
}

function validarItems(valor, { ivaRequerido = true, permitirVacio = false } = {}) {
  if (!Array.isArray(valor) || (!permitirVacio && !valor.length)) {
    throw new AppError('La compra debe incluir al menos un ítem.', 400);
  }
  return valor.map((item, indice) => {
    const tieneInsumo = item?.id_insumo != null;
    const tieneProducto = item?.id_producto != null;
    if (tieneInsumo === tieneProducto) throw new AppError(`El ítem ${indice + 1} debe indicar exactamente un id_insumo o id_producto.`, 400);
    const id_insumo = tieneInsumo ? enteroPositivo(item.id_insumo, `items[${indice}].id_insumo`) : null;
    const id_producto = tieneProducto ? enteroPositivo(item.id_producto, `items[${indice}].id_producto`) : null;
    const cantidad = numero(item.cantidad, `items[${indice}].cantidad`);
    const precio_unitario = numero(item.precio_unitario, `items[${indice}].precio_unitario`);
    const iva = item.iva === undefined && !ivaRequerido ? 0 : numero(item.iva, `items[${indice}].iva`);
    const medida = item.medida;
    if (typeof medida !== 'string' || !UNIDADES_COMPRA.has(medida.trim())) {
      throw new AppError(`La medida del ítem ${indice + 1} no es válida.`, 400);
    }
    if (cantidad <= 0) throw new AppError(`La cantidad del ítem ${indice + 1} debe ser mayor que cero.`, 400);
    if (precio_unitario < 0) throw new AppError(`El precio del ítem ${indice + 1} no puede ser negativo.`, 400);
    if (iva < 0 || iva > 100) throw new AppError(`El IVA del ítem ${indice + 1} debe estar entre 0 y 100.`, 400);
    let precio_venta;
    if (id_producto != null) {
      precio_venta = numero(item.precio_venta, `items[${indice}].precio_venta`);
      if (precio_venta <= 0) throw new AppError('El precio de venta debe ser mayor que cero.', 400);
    } else if (item.precio_venta !== undefined) {
      precio_venta = numero(item.precio_venta, `items[${indice}].precio_venta`);
    }
    return { id_insumo, id_producto, cantidad, medida: medida.trim(), precio_unitario, iva, precio_venta };
  });
}

export function validarIdCompra(valor) {
  return enteroPositivo(valor, 'id_compra');
}

export function validarCrearCompra(body) {
  const entrada = body || {};
  if (typeof entrada.iva_incluido !== 'boolean') throw new AppError('El campo iva_incluido debe ser booleano.', 400);
  return {
    n_factura: validarNumeroFactura(entrada.n_factura),
    fecha: fechaNoFutura(entrada.fecha),
    id_proveedor: entrada.id_proveedor == null || entrada.id_proveedor === '' ? null : enteroPositivo(entrada.id_proveedor, 'id_proveedor'),
    iva_incluido: entrada.iva_incluido,
    items: validarItems(entrada.items),
  };
}

export function validarRecepcionCompra(body) {
  const entrada = body || {};
  if (typeof entrada.iva_incluido !== 'boolean') throw new AppError('El campo iva_incluido debe ser booleano.', 400);
  const items = validarItems(entrada.items, { permitirVacio: true });
  const itemsNoSolicitados = validarItems(entrada.items_no_solicitados ?? [], { permitirVacio: true });
  if (!items.length && !itemsNoSolicitados.length) throw new AppError('La recepción debe incluir al menos un ítem recibido.', 400);
  return {
    n_factura: validarNumeroFactura(entrada.n_factura),
    fecha: fechaNoFutura(entrada.fecha),
    iva_incluido: entrada.iva_incluido,
    items,
    items_no_solicitados: itemsNoSolicitados,
  };
}

export function validarAnularCompra(body) {
  const motivo = body?.motivo;
  if (typeof motivo !== 'string' || !motivo.trim() || motivo.trim().length > 500) {
    throw new AppError('El motivo es obligatorio y no puede superar 500 caracteres.', 400);
  }
  return { motivo: motivo.trim() };
}

export function validarFiltrosCompras(query) {
  const filtros = {};
  if (query.estado !== undefined) {
    if (!['Recibido', 'Anulado'].includes(query.estado)) throw new AppError('El filtro estado no es válido.', 400);
    filtros.estado = query.estado;
  }
  for (const campo of ['id_proveedor', 'id_ocompra']) {
    if (query[campo] !== undefined) filtros[campo] = enteroPositivo(query[campo], campo);
  }
  return filtros;
}
