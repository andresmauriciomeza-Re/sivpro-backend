import AppError from '../errors/AppError.js';
import { UNIDADES_COMPRA } from '../utils/compras.js';

const ESTADOS = ['Borrador', 'Enviado', 'Completado', 'Anulado'];

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

function validarItems(valor) {
  if (!Array.isArray(valor) || valor.length === 0) throw new AppError('La orden de compra debe incluir al menos un ítem.', 400);
  const vistos = new Set();
  return valor.map((item, indice) => {
    const tieneInsumo = item?.id_insumo != null;
    const tieneProducto = item?.id_producto != null;
    if (tieneInsumo === tieneProducto) throw new AppError(`El ítem ${indice + 1} debe indicar exactamente un id_insumo o id_producto.`, 400);
    const id_insumo = tieneInsumo ? enteroPositivo(item.id_insumo, `items[${indice}].id_insumo`) : null;
    const id_producto = tieneProducto ? enteroPositivo(item.id_producto, `items[${indice}].id_producto`) : null;
    const key = `${tieneInsumo ? 'i' : 'p'}:${id_insumo ?? id_producto}`;
    if (vistos.has(key)) throw new AppError('No repitas ítems en la orden de compra.', 400);
    vistos.add(key);
    const medida = item.medida;
    if (typeof medida !== 'string' || !UNIDADES_COMPRA.has(medida.trim())) {
      throw new AppError(`La medida del ítem ${indice + 1} no es válida.`, 400);
    }
    const cantidad = numero(item.cantidad, `items[${indice}].cantidad`);
    const precio_unitario = numero(item.precio_unitario, `items[${indice}].precio_unitario`);
    const iva = item.iva === undefined ? 0 : numero(item.iva, `items[${indice}].iva`);
    if (cantidad <= 0) throw new AppError(`La cantidad del ítem ${indice + 1} debe ser mayor que cero.`, 400);
    if (precio_unitario < 0) throw new AppError(`El precio del ítem ${indice + 1} no puede ser negativo.`, 400);
    if (iva < 0 || iva > 100) throw new AppError(`El IVA del ítem ${indice + 1} debe estar entre 0 y 100.`, 400);
    return { id_insumo, id_producto, cantidad, medida: medida.trim(), precio_unitario, iva };
  });
}

export function validarIdOrdenCompra(valor) {
  return enteroPositivo(valor, 'id_ocompra');
}

export function validarCrearOrdenCompra(body) {
  const entrada = body || {};
  const estadoInicial = entrada.estado_inicial ?? 'Borrador';
  if (!['Borrador', 'Enviado'].includes(estadoInicial)) {
    throw new AppError("estado_inicial debe ser 'Borrador' o 'Enviado'.", 400);
  }
  return {
    id_proveedor: enteroPositivo(entrada.id_proveedor, 'id_proveedor'),
    estado_inicial: estadoInicial,
    items: validarItems(entrada.items),
  };
}

export function validarEditarOrdenCompra(body) {
  const entrada = body || {};
  return {
    id_proveedor: enteroPositivo(entrada.id_proveedor, 'id_proveedor'),
    items: validarItems(entrada.items),
  };
}

export function validarEstadoOrdenCompra(body) {
  const estado = body?.estado;
  if (!ESTADOS.includes(estado)) throw new AppError('El estado de la orden de compra no es válido.', 400);
  const motivo = body?.motivo == null || body.motivo === '' ? null : String(body.motivo).trim();
  if (motivo != null && motivo.length > 500) throw new AppError('El motivo no puede superar 500 caracteres.', 400);
  if (estado === 'Anulado' && !motivo) throw new AppError('El motivo es obligatorio para anular la orden de compra.', 400);
  return { estado, motivo };
}

export function validarFiltrosOrdenCompra(query) {
  const filtros = {};
  if (query.estado !== undefined) {
    if (!ESTADOS.includes(query.estado)) throw new AppError('El filtro estado no es válido.', 400);
    filtros.estado = query.estado;
  }
  if (query.id_proveedor !== undefined) filtros.id_proveedor = enteroPositivo(query.id_proveedor, 'id_proveedor');
  return filtros;
}
