import AppError from '../errors/AppError.js';

const ESTADOS = ['Pendiente', 'En proceso', 'Completada', 'Cancelada'];
const TIPOS = ['Preparacion', 'Pedido'];

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
  if (!Number.isSafeInteger(resultado) || resultado <= 0) {
    throw new AppError(`El campo ${campo} debe ser un entero mayor que cero.`, 400);
  }
  return resultado;
}

function textoOpcional(valor, campo, max) {
  if (valor == null || valor === '') return null;
  if (typeof valor !== 'string' || valor.trim().length > max) {
    throw new AppError(`El campo ${campo} no puede superar ${max} caracteres.`, 400);
  }
  return valor.trim() || null;
}

function validarFecha(valor) {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    throw new AppError('La fecha solicitada debe tener formato YYYY-MM-DD.', 400);
  }
  const [anio, mes, dia] = valor.split('-').map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  if (fecha.toISOString().slice(0, 10) !== valor) throw new AppError('La fecha solicitada no es válida.', 400);
  return valor;
}

function validarHora(valor) {
  if (valor == null || valor === '') return null;
  if (typeof valor !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(valor)) {
    throw new AppError('La hora solicitada debe tener formato HH:mm.', 400);
  }
  return valor.length === 5 ? `${valor}:00` : valor;
}

export function validarIdOrdenProduccion(valor) {
  return enteroPositivo(valor, 'id_orden_produccion');
}

function idOpcional(valor, campo, indice) {
  if (valor == null || valor === '') return null;
  return enteroPositivo(valor, `lineas[${indice}].${campo}`);
}

/** Cada línea lleva un producto insumo (id_insumo) o un producto del menú
 *  (id_producto). El frontend de "cantidad inicial" manda el id del producto
 *  creado por el campo id_insumo: el servicio resuelve hacia qué tabla apunta,
 *  así que aquí sólo se exige que venga UNO de los dos. */
export function validarLineasPreparacion(valor) {
  if (!Array.isArray(valor) || valor.length === 0) {
    throw new AppError('La preparación debe incluir al menos una línea.', 400);
  }
  const vistos = new Set();
  return valor.map((linea, indice) => {
    const id_insumo = idOpcional(linea?.id_insumo, 'id_insumo', indice);
    const id_producto = idOpcional(linea?.id_producto, 'id_producto', indice);
    if (id_insumo == null && id_producto == null) {
      throw new AppError(`La línea ${indice + 1} debe incluir id_insumo o id_producto.`, 400);
    }
    if (id_insumo != null && id_producto != null) {
      throw new AppError(`La línea ${indice + 1} no puede llevar id_insumo e id_producto a la vez.`, 400);
    }
    const clave = id_producto != null ? `producto:${id_producto}` : `insumo:${id_insumo}`;
    if (vistos.has(clave)) {
      throw new AppError(
        id_producto != null ? 'No repitas productos en las líneas.' : 'No repitas productos insumo en las líneas.',
        400
      );
    }
    vistos.add(clave);
    const cantidad = numero(linea?.cantidad, `lineas[${indice}].cantidad`);
    if (cantidad <= 0) throw new AppError(`La cantidad de la línea ${indice + 1} debe ser mayor que cero.`, 400);
    // tb_productos.stock es entero: una línea de producto sólo acepta unidades.
    if (id_producto != null && !Number.isSafeInteger(cantidad)) {
      throw new AppError(`La cantidad de la línea ${indice + 1} debe ser un número entero.`, 400);
    }
    return { id_insumo, id_producto, cantidad };
  });
}

export function validarCrearOrdenProduccion(body) {
  const entrada = body || {};
  if (entrada.tipo !== undefined && entrada.tipo !== 'Preparacion') {
    throw new AppError("Solo se pueden crear órdenes de tipo 'Preparacion' desde esta ruta.", 400);
  }
  return {
    tipo: 'Preparacion',
    fecha_solicitada: validarFecha(entrada.fecha_solicitada),
    hora_solicitada: validarHora(entrada.hora_solicitada),
    observacion: textoOpcional(entrada.observacion, 'observacion', 255),
    lineas: validarLineasPreparacion(entrada.lineas),
  };
}

export function validarEditarOrdenProduccion(body) {
  const entrada = body || {};
  const datos = {};
  if (entrada.fecha_solicitada !== undefined) datos.fecha_solicitada = validarFecha(entrada.fecha_solicitada);
  if (entrada.hora_solicitada !== undefined) datos.hora_solicitada = validarHora(entrada.hora_solicitada);
  if (entrada.observacion !== undefined) datos.observacion = textoOpcional(entrada.observacion, 'observacion', 255);
  if (entrada.lineas !== undefined) datos.lineas = validarLineasPreparacion(entrada.lineas);
  return datos;
}

export function validarCompletarOrdenProduccion(body) {
  const entrada = body || {};
  if (entrada.lineas === undefined) {
    if (Object.keys(entrada).length) throw new AppError('La finalización de un pedido no recibe body.', 400);
    return { lineas: null };
  }
  if (!Array.isArray(entrada.lineas)) throw new AppError('El campo lineas debe ser un arreglo.', 400);
  if (entrada.lineas.length === 0) throw new AppError('La preparación debe incluir la cantidad real de todas sus líneas.', 400);
  const vistos = new Set();
  return {
    lineas: entrada.lineas.map((linea, indice) => {
      const id_detalle_op = enteroPositivo(linea?.id_detalle_op, `lineas[${indice}].id_detalle_op`);
      if (vistos.has(id_detalle_op)) throw new AppError('No repitas detalles de orden.', 400);
      vistos.add(id_detalle_op);
      const cantidad_real = numero(linea?.cantidad_real, `lineas[${indice}].cantidad_real`);
      if (cantidad_real < 0) throw new AppError('La cantidad real no puede ser negativa.', 400);
      return { id_detalle_op, cantidad_real };
    }),
  };
}

export function validarDarBajaOrdenProduccion(body) {
  const motivo = body?.motivo;
  const descripcion = body?.descripcion;
  if (typeof motivo !== 'string' || !motivo.trim() || motivo.trim().length > 100) {
    throw new AppError('El motivo es obligatorio y no puede superar 100 caracteres.', 400);
  }
  if (typeof descripcion !== 'string' || !descripcion.trim() || descripcion.trim().length > 500) {
    throw new AppError('La descripción es obligatoria y no puede superar 500 caracteres.', 400);
  }
  return { motivo: motivo.trim(), descripcion: descripcion.trim() };
}

export function validarFiltrosOrdenesProduccion(query) {
  const filtros = {};
  if (query.estado !== undefined) {
    if (!ESTADOS.includes(query.estado)) throw new AppError('El filtro estado no es válido.', 400);
    filtros.estado = query.estado;
  }
  if (query.tipo !== undefined) {
    if (!TIPOS.includes(query.tipo)) throw new AppError('El filtro tipo no es válido.', 400);
    filtros.tipo = query.tipo;
  }
  return filtros;
}
