import AppError from '../errors/AppError.js';

/** Catálogos de producto. El tipo también condiciona qué campos son
    obligatorios: Elaborado pide precio; Reventa pide los datos de bebida. */
const TIPOS_PRODUCTO = ['Elaborado', 'Reventa'];
const ESTADOS_PRODUCTO = ['Descontinuado', 'Automático'];
const CONTENIDO_UNIDADES = ['ml', 'L'];
const UNIDADES_COMPRA = ['und', 'paca', 'caja'];

// Límites iguales a los de la base (varchar).
const MIN_NOMBRE = 2;
const MAX_NOMBRE = 100;
const MAX_UNIDAD_VENTA = 20;
const MAX_IMAGEN = 255;
const MIN_UNIDADES_EMPAQUE = 2;

function texto(valor, campo, max) {
  if (typeof valor !== 'string' || !valor.trim() || valor.trim().length > max) {
    throw new AppError(`El campo ${campo} es obligatorio y no puede superar ${max} caracteres.`, 400);
  }
  return valor.trim();
}

function textoOpcional(valor, campo, max) {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== 'string') {
    throw new AppError(`El campo ${campo} debe ser texto.`, 400);
  }
  const limpio = valor.trim();
  if (!limpio) return null; // cadena vacía = sin imagen
  if (limpio.length > max) {
    throw new AppError(`El campo ${campo} no puede superar ${max} caracteres.`, 400);
  }
  return limpio;
}

/** Acepta número o string numérico; rechaza vacíos, booleanos, null y NaN. */
function numero(valor, campo) {
  if (valor === undefined || valor === null || typeof valor === 'boolean') {
    throw new AppError(`El campo ${campo} debe ser un número.`, 400);
  }
  if (typeof valor === 'string' && !valor.trim()) {
    throw new AppError(`El campo ${campo} debe ser un número.`, 400);
  }
  const n = Number(valor);
  if (!Number.isFinite(n)) {
    throw new AppError(`El campo ${campo} debe ser un número.`, 400);
  }
  return n;
}

function entero(valor, campo, min) {
  const n = numero(valor, campo);
  if (!Number.isSafeInteger(n) || n < min) {
    const regla = min === 0 ? 'entero mayor a 0' : `entero mayor o igual a ${min}`;
    throw new AppError(`El campo ${campo} debe ser un ${regla}.`, 400);
  }
  return n;
}

/** Nombre de producto: trim + colapsa espacios dobles a uno solo (regex \s+). */
export function normalizarNombreProducto(valor) {
  const limpio = typeof valor === 'string' ? valor.trim().replace(/\s+/g, ' ') : '';
  if (limpio.length < MIN_NOMBRE || limpio.length > MAX_NOMBRE) {
    throw new AppError(
      `El nombre no es válido: debe tener entre ${MIN_NOMBRE} y ${MAX_NOMBRE} caracteres.`,
      400
    );
  }
  return limpio;
}

export function validarIdProducto(valor) {
  const id = Number(valor);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new AppError('El id de producto no es válido.', 400);
  }
  return id;
}

function validarTipo(valor) {
  const tipo = texto(valor, 'tipo', 20);
  if (!TIPOS_PRODUCTO.includes(tipo)) {
    throw new AppError('El tipo de producto no es válido.', 400);
  }
  return tipo;
}

function validarPrecioVenta(valor) {
  const precio = numero(valor, 'precio_venta');
  if (precio <= 0) throw new AppError('El precio de venta debe ser mayor a 0.', 400);
  return precio;
}

function validarPrecioGrande(valor) {
  if (valor === null || (typeof valor === 'string' && !valor.trim())) return null;
  return numero(valor, 'precio_grande');
}

/** Campos propios de las bebidas (Reventa). En edición solo se pasan los que
    trae el body: la coherencia con lo guardado la resuelve el servicio. */
function validarCamposBebida(body) {
  const salida = {};

  if (body.contenido !== undefined) {
    const contenido = numero(body.contenido, 'contenido');
    if (contenido <= 0) throw new AppError('El contenido debe ser mayor a 0.', 400);
    salida.contenido = contenido;
  }

  if (body.contenido_unidad !== undefined) {
    const unidad = texto(body.contenido_unidad, 'contenido_unidad', 10);
    if (!CONTENIDO_UNIDADES.includes(unidad)) {
      throw new AppError("La unidad de contenido debe ser 'ml' o 'L'.", 400);
    }
    salida.contenido_unidad = unidad;
  }

  if (body.unidad_compra !== undefined) {
    const unidad = texto(body.unidad_compra, 'unidad_compra', 10);
    if (!UNIDADES_COMPRA.includes(unidad)) {
      throw new AppError("La unidad de compra debe ser 'und', 'paca' o 'caja'.", 400);
    }
    salida.unidad_compra = unidad;
    // Regla de la base: comprado por unidad no lleva empaque.
    if (unidad === 'und') salida.unidades_por_empaque = null;
  }

  if (body.unidades_por_empaque !== undefined && salida.unidades_por_empaque === undefined) {
    // entero() ya exige >= MIN_UNIDADES_EMPAQUE (2).
    salida.unidades_por_empaque = entero(
      body.unidades_por_empaque,
      'unidades_por_empaque',
      MIN_UNIDADES_EMPAQUE
    );
  }

  return salida;
}

/**
 * POST /api/productos
 * Elaborado: precio_venta > 0 obligatorio.
 * Reventa: contenido + contenido_unidad + unidad_compra obligatorios y, si la
 * unidad de compra es paca o caja, unidades_por_empaque >= 2.
 * En Reventa el precio que traiga el body se DESCARTA: nace en 0.
 */
export function validarCreacionProducto(body) {
  const entrada = body || {};
  const datos = {
    id_categoria: entero(entrada.id_categoria, 'id_categoria', 1),
    nombre: normalizarNombreProducto(entrada.nombre),
    tipo: validarTipo(entrada.tipo),
    unidad_venta: texto(entrada.unidad_venta, 'unidad_venta', MAX_UNIDAD_VENTA),
    imagen: textoOpcional(entrada.imagen, 'imagen', MAX_IMAGEN),
  };

  if (datos.tipo === 'Elaborado') {
    return {
      ...datos,
      precio_venta: validarPrecioVenta(entrada.precio_venta),
      precio_grande: entrada.precio_grande === undefined ? null : validarPrecioGrande(entrada.precio_grande),
      contenido: null,
      contenido_unidad: null,
      unidad_compra: null,
      unidades_por_empaque: null,
    };
  }

  // Reventa: siempre nace en 0, sin importar lo que envíe el body.
  for (const campo of ['contenido', 'contenido_unidad', 'unidad_compra']) {
    if (entrada[campo] === undefined || entrada[campo] === null || entrada[campo] === '') {
      throw new AppError(`El campo ${campo} es obligatorio para las bebidas.`, 400);
    }
  }
  const bebida = validarCamposBebida(entrada);
  if (bebida.unidades_por_empaque === undefined) {
    if (entrada.unidad_compra === 'und') {
      bebida.unidades_por_empaque = null;
    } else {
      throw new AppError(
        `El campo unidades_por_empaque es obligatorio (mínimo ${MIN_UNIDADES_EMPAQUE}) para paca o caja.`,
        400
      );
    }
  }

  return {
    ...datos,
    precio_venta: 0,
    precio_grande: entrada.precio_grande === undefined ? null : validarPrecioGrande(entrada.precio_grande),
    ...bebida,
  };
}

/**
 * PUT /api/productos/:id — actualización PARCIAL: solo se devuelven las
 * claves presentes en el body; el servicio ignora las ausentes.
 * `tipo` se devuelve tal cual aquí; el servicio lo compara con lo guardado y
 * responde 400 solo si difiere (si coincide, no se escribe).
 */
export function validarEdicionProducto(body) {
  const entrada = body || {};
  const datos = {};

  if (entrada.nombre !== undefined) datos.nombre = normalizarNombreProducto(entrada.nombre);
  if (entrada.id_categoria !== undefined) {
    datos.id_categoria = entero(entrada.id_categoria, 'id_categoria', 1);
  }
  if (entrada.unidad_venta !== undefined) {
    datos.unidad_venta = texto(entrada.unidad_venta, 'unidad_venta', MAX_UNIDAD_VENTA);
  }
  if (entrada.imagen !== undefined) datos.imagen = textoOpcional(entrada.imagen, 'imagen', MAX_IMAGEN);
  if (entrada.tipo !== undefined) datos.tipo = validarTipo(entrada.tipo);
  if (entrada.precio_venta !== undefined) datos.precio_venta = validarPrecioVenta(entrada.precio_venta);
  if (entrada.precio_grande !== undefined) datos.precio_grande = validarPrecioGrande(entrada.precio_grande);

  Object.assign(datos, validarCamposBebida(entrada));

  return datos;
}

export function validarEstadoProducto(body) {
  const estado = typeof body?.estado === 'string' ? body.estado.trim() : '';
  if (!ESTADOS_PRODUCTO.includes(estado)) {
    throw new AppError("El estado debe ser 'Descontinuado' o 'Automático'.", 400);
  }
  return { estado };
}

/**
 * POST /api/productos/:id/entrada-compra
 * `unidades` ya viene multiplicada por el empaque; `costo_unitario` y
 * `precio_venta` son valores POR UNIDAD con IVA.
 */
export function validarEntradaCompra(body) {
  const entrada = body || {};
  const unidades = entero(entrada.unidades, 'unidades', 1);
  const costoUnitario = numero(entrada.costo_unitario, 'costo_unitario');
  if (costoUnitario <= 0) throw new AppError('El costo unitario debe ser mayor a 0.', 400);

  const precioVenta = numero(entrada.precio_venta, 'precio_venta');
  if (precioVenta <= costoUnitario) {
    throw new AppError('El precio de venta debe ser mayor al costo unitario.', 400);
  }

  const montoSinIva = numero(entrada.ultimo_monto_sin_iva, 'ultimo_monto_sin_iva');
  if (montoSinIva < 0) throw new AppError('El monto sin IVA no puede ser negativo.', 400);

  const iva = numero(entrada.ultimo_iva_compra, 'ultimo_iva_compra');
  if (iva < 0 || iva > 100) throw new AppError('El IVA de compra debe estar entre 0 y 100.', 400);

  // Punto C1: monto unitario OPCIONAL tal cual lo digitó el usuario (sin
  // convertir por IVA). Si no llega, null: el UPDATE usa COALESCE y conserva
  // el último valor guardado.
  let montoDigitado = null;
  if (entrada.ultimo_monto_digitado !== undefined && entrada.ultimo_monto_digitado !== null) {
    montoDigitado = numero(entrada.ultimo_monto_digitado, 'ultimo_monto_digitado');
    if (montoDigitado < 0) throw new AppError('El monto digitado no puede ser negativo.', 400);
  }

  return {
    unidades,
    costo_unitario: costoUnitario,
    precio_venta: precioVenta,
    ultimo_monto_sin_iva: montoSinIva,
    ultimo_iva_compra: iva,
    ultimo_monto_digitado: montoDigitado,
  };
}

export function validarReversaCompra(body) {
  return { unidades: entero((body || {}).unidades, 'unidades', 1) };
}
