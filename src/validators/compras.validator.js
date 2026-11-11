import AppError from '../errors/AppError.js';
import { derivarIvaIncluidoGlobal, MODOS_IVA, UNIDADES_COMPRA, resolverModoIva } from '../utils/compras.js';
import { normalizarNombreInsumo, UNIDADES_BASE_INSUMO, UNIDADES_INSUMO } from '../utils/insumos.js';

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

function validarFechaCalendario(valor) {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor.trim())) {
    throw new AppError('La fecha es obligatoria y debe tener formato YYYY-MM-DD.', 400);
  }
  const limpia = valor.trim();
  const [anio, mes, dia] = limpia.split('-').map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  if (fecha.toISOString().slice(0, 10) !== limpia) throw new AppError('La fecha no es válida.', 400);
  return limpia;
}

/**
 * Valida el `modo_iva` de un ítem (regla 2.1). Si no viene, se resuelve con
 * el IVA global de la petición (retrocompatibilidad) y por defecto queda
 * 'incluido'. Con 'exento' el porcentaje se fuerza a 0.
 */
function validarModoIvaItem(item, ivaIncluidoGlobal, campo, indice, etiqueta = 'ítem') {
  let modoIva;
  try {
    modoIva = resolverModoIva({ modo_iva: item?.modo_iva }, ivaIncluidoGlobal);
  } catch (error) {
    if (error instanceof AppError) {
      throw new AppError(`El campo ${campo}[${indice}].modo_iva no es válido (${MODOS_IVA.join(', ')}).`, 400);
    }
    throw error;
  }
  const ivaVacio =
    item?.iva === undefined ||
    item?.iva === null ||
    (typeof item.iva === 'string' && !item.iva.trim());
  if (modoIva !== 'exento' && ivaVacio) {
    throw new AppError(`El IVA del ${etiqueta} ${indice + 1} es obligatorio.`, 400);
  }
  const iva = modoIva === 'exento' ? 0 : numero(item.iva, `${campo}[${indice}].iva`);
  return { modo_iva: modoIva, iva };
}

/**
 * Regla 2.2: factor de presentación opcional (cuántas unidades base trae
 * cada presentación). Si no viene, se usa el configurado en el insumo.
 */
function validarFactorPresentacion(valor, campo) {
  if (valor === undefined || valor === null || valor === '') return null;
  const factor = numero(valor, campo);
  if (factor <= 0) throw new AppError(`El campo ${campo} debe ser un número mayor que cero.`, 400);
  return factor;
}

/**
 * Regla 2.2: unidad base opcional de un insumo nuevo recibido en
 * presentación (solo para ítems sin id_insumo).
 */
function validarUnidadBase(valor, campo) {
  if (valor === undefined || valor === null || valor === '') return null;
  const unidad = String(valor).trim();
  if (!UNIDADES_BASE_INSUMO.includes(unidad)) {
    throw new AppError(`El campo ${campo} debe ser una unidad base válida (${UNIDADES_BASE_INSUMO.join(', ')}).`, 400);
  }
  return unidad;
}

function validarItems(valor, { permitirVacio = false, ivaIncluidoGlobal = undefined } = {}) {
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
    const { modo_iva, iva } = validarModoIvaItem(item, ivaIncluidoGlobal, 'items', indice);
    if (iva < 0 || iva > 100) {
      throw new AppError(`El IVA del ítem ${indice + 1} debe estar entre 0 y 100.`, 400);
    }
    const medida = item.medida;
    if (typeof medida !== 'string' || !UNIDADES_COMPRA.has(medida.trim())) {
      throw new AppError(`La medida del ítem ${indice + 1} no es válida.`, 400);
    }
    if (cantidad <= 0) throw new AppError(`La cantidad del ítem ${indice + 1} debe ser mayor que cero.`, 400);
    if (precio_unitario <= 0) throw new AppError(`El precio del ítem ${indice + 1} debe ser mayor que cero.`, 400);
    let precio_venta;
    if (id_producto != null) {
      precio_venta = numero(item.precio_venta, `items[${indice}].precio_venta`);
      if (precio_venta <= 0) throw new AppError('El precio de venta debe ser mayor que cero.', 400);
    } else if (item.precio_venta !== undefined) {
      precio_venta = numero(item.precio_venta, `items[${indice}].precio_venta`);
    }
    // Regla 2.2: factor de presentación opcional (si no viene, se usa el
    // configurado en el insumo).
    const factor_presentacion = validarFactorPresentacion(item.factor_presentacion, `items[${indice}].factor_presentacion`);
    return { id_insumo, id_producto, cantidad, medida: medida.trim(), precio_unitario, iva, modo_iva, precio_venta, factor_presentacion };
  });
}

function validarItemsNoSolicitados(valor, { ivaIncluidoGlobal = undefined } = {}) {
  if (!Array.isArray(valor)) {
    throw new AppError('El campo items_no_solicitados debe ser un arreglo.', 400);
  }
  return valor.map((item, indice) => {
    const tieneInsumo = item?.id_insumo != null && item?.id_insumo !== '';
    const tieneProducto = item?.id_producto != null && item?.id_producto !== '';
    if (tieneInsumo && tieneProducto) {
      throw new AppError(`El ítem no solicitado ${indice + 1} no puede indicar id_insumo e id_producto al mismo tiempo.`, 400);
    }

    const cantidad = numero(item?.cantidad, `items_no_solicitados[${indice}].cantidad`);
    const precio_unitario = numero(item?.precio_unitario, `items_no_solicitados[${indice}].precio_unitario`);
    const { modo_iva, iva } = validarModoIvaItem(
      item,
      ivaIncluidoGlobal,
      'items_no_solicitados',
      indice,
      'ítem no solicitado',
    );
    if (iva < 0 || iva > 100) {
      throw new AppError(`El IVA del ítem no solicitado ${indice + 1} debe estar entre 0 y 100.`, 400);
    }
    if (cantidad <= 0) throw new AppError(`La cantidad del ítem no solicitado ${indice + 1} debe ser mayor que cero.`, 400);
    if (precio_unitario <= 0) throw new AppError(`El precio del ítem no solicitado ${indice + 1} debe ser mayor que cero.`, 400);

    if (tieneInsumo || tieneProducto) {
      const id_insumo = tieneInsumo ? enteroPositivo(item.id_insumo, `items_no_solicitados[${indice}].id_insumo`) : null;
      const id_producto = tieneProducto ? enteroPositivo(item.id_producto, `items_no_solicitados[${indice}].id_producto`) : null;
      const medida = item?.medida;
      if (typeof medida !== 'string' || !UNIDADES_COMPRA.has(medida.trim())) {
        throw new AppError(`La medida del ítem no solicitado ${indice + 1} no es válida.`, 400);
      }
      let precio_venta;
      if (id_producto != null) {
        precio_venta = numero(item.precio_venta, `items_no_solicitados[${indice}].precio_venta`);
        if (precio_venta <= 0) throw new AppError('El precio de venta debe ser mayor que cero.', 400);
      } else if (item.precio_venta !== undefined) {
        precio_venta = numero(item.precio_venta, `items_no_solicitados[${indice}].precio_venta`);
      }
      const factor_presentacion = validarFactorPresentacion(
        item.factor_presentacion,
        `items_no_solicitados[${indice}].factor_presentacion`
      );
      return { id_insumo, id_producto, cantidad, medida: medida.trim(), precio_unitario, iva, modo_iva, precio_venta, factor_presentacion };
    }

    // Regla 9: Insumo no solicitado inexistente (se crea dentro de la transacción de recepción).
    const nombre = normalizarNombreInsumo(item?.nombre);
    if (nombre.length < 2 || nombre.length > 100) {
      throw new AppError(`El nombre del insumo no solicitado ${indice + 1} es obligatorio y debe tener entre 2 y 100 caracteres.`, 400);
    }
    if (item?.id_categoria_insumo === undefined || item?.id_categoria_insumo === null || item?.id_categoria_insumo === '') {
      throw new AppError(`El campo items_no_solicitados[${indice}].id_categoria_insumo es obligatorio para crear un insumo no solicitado nuevo.`, 400);
    }
    const id_categoria_insumo = enteroPositivo(item.id_categoria_insumo, `items_no_solicitados[${indice}].id_categoria_insumo`);
    const medida = item?.medida;
    // Regla 2.2: se acepta el catálogo completo de compras; las
    // presentaciones que nunca fueron unidad base (paca, sixpack) exigen
    // unidad_base y factor_presentacion porque el insumo aún no existe.
    if (typeof medida !== 'string' || !UNIDADES_COMPRA.has(medida.trim())) {
      throw new AppError(
        `La medida del insumo no solicitado ${indice + 1} debe ser una unidad válida (${[...UNIDADES_COMPRA].join(', ')}).`,
        400
      );
    }
    const factor_presentacion = validarFactorPresentacion(
      item?.factor_presentacion,
      `items_no_solicitados[${indice}].factor_presentacion`
    );
    const unidad_base = validarUnidadBase(item?.unidad_base, `items_no_solicitados[${indice}].unidad_base`);
    const medidaLimpia = medida.trim();
    if (factor_presentacion != null && !unidad_base) {
      throw new AppError(
        `El insumo no solicitado ${indice + 1}: si indicas factor_presentacion debes indicar también unidad_base.`,
        400
      );
    }
    if (!UNIDADES_INSUMO.includes(medidaLimpia) && (!unidad_base || factor_presentacion == null)) {
      throw new AppError(
        `El insumo no solicitado ${indice + 1} se recibió en presentación «${medidaLimpia}»: indica unidad_base (${UNIDADES_BASE_INSUMO.join(', ')}) y factor_presentacion (cuántas unidades base trae cada ${medidaLimpia}).`,
        400
      );
    }
    const stock_minimo =
      item?.stock_minimo === undefined ? 0 : numero(item.stock_minimo, `items_no_solicitados[${indice}].stock_minimo`);
    if (stock_minimo < 0) {
      throw new AppError(`El stock_minimo del insumo no solicitado ${indice + 1} no puede ser negativo.`, 400);
    }

    return {
      id_insumo: null,
      id_producto: null,
      nuevo_insumo: true,
      nombre,
      id_categoria_insumo,
      medida: medidaLimpia,
      cantidad,
      precio_unitario,
      iva,
      modo_iva,
      stock_minimo,
      unidad_base,
      factor_presentacion,
    };
  });
}

export function validarIdCompra(valor) {
  return enteroPositivo(valor, 'id_compra');
}

/**
 * El IVA global dejó de ser obligatorio (regla 2.1): solo se acepta para
 * retrocompatibilidad con peticiones antiguas. Devuelve `undefined` si no
 * viene.
 */
function validarIvaIncluidoGlobal(valor) {
  if (valor === undefined || valor === null || valor === '') return undefined;
  if (typeof valor !== 'boolean') throw new AppError('El campo iva_incluido debe ser booleano.', 400);
  return valor;
}

export function validarCrearCompra(body) {
  const entrada = body || {};
  const ivaIncluidoGlobal = validarIvaIncluidoGlobal(entrada.iva_incluido);
  const items = validarItems(entrada.items, { ivaIncluidoGlobal });
  return {
    n_factura: validarNumeroFactura(entrada.n_factura),
    fecha: validarFechaCalendario(entrada.fecha),
    id_proveedor: entrada.id_proveedor == null || entrada.id_proveedor === '' ? null : enteroPositivo(entrada.id_proveedor, 'id_proveedor'),
    // Dato derivado (regla 2.1): true si todas las líneas son 'incluido',
    // false si todas son 'mas_iva' y NULL si hay mezcla o exentos. El global
    // antiguo solo entra como fallback de las líneas que no traen modo.
    iva_incluido: derivarIvaIncluidoGlobal(items, ivaIncluidoGlobal),
    items,
  };
}

export function validarRecepcionCompra(body) {
  const entrada = body || {};
  const ivaIncluidoGlobal = validarIvaIncluidoGlobal(entrada.iva_incluido);
  const items = validarItems(entrada.items ?? [], { permitirVacio: true, ivaIncluidoGlobal });
  const itemsNoSolicitados = validarItemsNoSolicitados(entrada.items_no_solicitados ?? [], { ivaIncluidoGlobal });
  if (!items.length && !itemsNoSolicitados.length) throw new AppError('La recepción debe incluir al menos un ítem recibido.', 400);
  return {
    n_factura: validarNumeroFactura(entrada.n_factura),
    fecha: validarFechaCalendario(entrada.fecha),
    iva_incluido: derivarIvaIncluidoGlobal([...items, ...itemsNoSolicitados], ivaIncluidoGlobal),
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
