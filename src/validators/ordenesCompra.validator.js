import AppError from '../errors/AppError.js';
import { UNIDADES_COMPRA } from '../utils/compras.js';

const ESTADOS = ['Borrador', 'Enviado', 'Completado', 'Anulado'];
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

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

function validarFechaFiltro(valor, campo) {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor.trim())) {
    throw new AppError(`El filtro ${campo} debe tener formato YYYY-MM-DD.`, 400);
  }
  const limpia = valor.trim();
  const [anio, mes, dia] = limpia.split('-').map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  if (fecha.toISOString().slice(0, 10) !== limpia) {
    throw new AppError(`El filtro ${campo} no es una fecha válida.`, 400);
  }
  return limpia;
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

    if (typeof item?.medida !== 'string' || !UNIDADES_COMPRA.has(item.medida.trim())) {
      throw new AppError(`La medida del ítem ${indice + 1} no es válida.`, 400);
    }
    const medida = item.medida.trim();

    const cantidad = numero(item.cantidad, `items[${indice}].cantidad`);
    const precio_unitario = numero(item.precio_unitario, `items[${indice}].precio_unitario`);
    const iva = item.iva === undefined ? 0 : numero(item.iva, `items[${indice}].iva`);
    if (cantidad <= 0) throw new AppError(`La cantidad del ítem ${indice + 1} debe ser mayor que cero.`, 400);
    if (precio_unitario <= 0) throw new AppError(`El precio del ítem ${indice + 1} debe ser mayor que cero.`, 400);
    if (iva < 0 || iva > 100) throw new AppError(`El IVA del ítem ${indice + 1} debe estar entre 0 y 100.`, 400);
    return { id_insumo, id_producto, cantidad, medida, precio_unitario, iva };
  });
}

export function validarIdOrdenCompra(valor) {
  return enteroPositivo(valor, 'id_ocompra');
}

export function validarCrearOrdenCompra(body) {
  const entrada = body || {};
  if (entrada.estado_inicial !== undefined && entrada.estado_inicial !== 'Borrador') {
    throw new AppError("La orden de compra siempre debe crearse en estado 'Borrador'.", 400);
  }
  return {
    id_proveedor: enteroPositivo(entrada.id_proveedor, 'id_proveedor'),
    estado_inicial: 'Borrador',
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

export function validarFiltrosOrdenCompra(query = {}) {
  const filtros = {};
  if (query.estado !== undefined && query.estado !== '') {
    if (!ESTADOS.includes(query.estado)) throw new AppError('El filtro estado no es válido.', 400);
    filtros.estado = query.estado;
  }
  if (query.id_proveedor !== undefined && query.id_proveedor !== '') {
    filtros.id_proveedor = enteroPositivo(query.id_proveedor, 'id_proveedor');
  }
  if (query.desde !== undefined && query.desde !== '') {
    filtros.desde = validarFechaFiltro(query.desde, 'desde');
  }
  if (query.hasta !== undefined && query.hasta !== '') {
    filtros.hasta = validarFechaFiltro(query.hasta, 'hasta');
  }
  if (filtros.desde && filtros.hasta && filtros.desde > filtros.hasta) {
    throw new AppError('La fecha inicial (desde) no puede ser mayor que la fecha final (hasta).', 400);
  }

  const textoBusqueda = query.q ?? query.busqueda ?? query.search;
  if (textoBusqueda !== undefined && textoBusqueda !== null && String(textoBusqueda).trim() !== '') {
    const limpio = String(textoBusqueda).trim();
    if (limpio.length > 100) {
      throw new AppError('El texto de búsqueda no puede superar 100 caracteres.', 400);
    }
    filtros.busqueda = limpio;
  }

  const tienePaginacion = query.page !== undefined || query.limit !== undefined;
  if (tienePaginacion) {
    const page = query.page === undefined || query.page === '' ? DEFAULT_PAGE : enteroPositivo(query.page, 'page');
    const limit = query.limit === undefined || query.limit === '' ? DEFAULT_LIMIT : enteroPositivo(query.limit, 'limit');
    if (limit > MAX_LIMIT) {
      throw new AppError(`El límite por página (limit) no puede superar ${MAX_LIMIT}.`, 400);
    }
    filtros.paginar = true;
    filtros.page = page;
    filtros.limit = limit;
  } else {
    filtros.paginar = false;
  }

  return filtros;
}
