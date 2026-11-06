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

function tamanoOpcional(valor, indice) {
  if (valor == null || valor === '') return null;
  if (!['Mediana', 'Grande', 'Normal'].includes(valor)) {
    throw new AppError(`El tamaño de la línea ${indice + 1} no es válido.`, 400);
  }
  return valor;
}

export function validarTamanoPizzaPreparacion(tamano, nombre) {
  if (!['Mediana', 'Grande'].includes(tamano)) {
    throw new AppError(`Selecciona Mediana o Grande para ${nombre}.`, 400);
  }
  return tamano;
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

function validarFechaHoraLocal(valor) {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(valor)) {
    throw new AppError('La fecha y hora límite debe tener formato YYYY-MM-DDTHH:mm.', 400);
  }
  const [fecha, hora] = valor.split('T');
  validarFecha(fecha);
  return `${fecha} ${hora}:00`;
}

export function validarIdOrdenProduccion(valor) {
  return enteroPositivo(valor, 'id_orden_produccion');
}

export function validarGenerarOrdenProduccion(body) {
  const entrada = body || {};
  const salida = {
    fecha_entrega_estimada: validarFechaHoraLocal(entrada.fecha_entrega_estimada),
  };
  if (entrada.fecha_limite_automatica !== undefined) {
    if (typeof entrada.fecha_limite_automatica !== 'boolean') {
      throw new AppError('La fecha límite automática debe ser verdadera o falsa.', 400);
    }
    salida.fecha_limite_automatica = entrada.fecha_limite_automatica;
  }
  if (entrada.lineas !== undefined) {
    if (!Array.isArray(entrada.lineas) || entrada.lineas.length === 0) {
      throw new AppError('Debes enviar la cantidad de todas las líneas de la orden.', 400);
    }
    const vistos = new Set();
    salida.lineas = entrada.lineas.map((linea, indice) => {
      const id_detalle_op = enteroPositivo(linea?.id_detalle_op, `lineas[${indice}].id_detalle_op`);
      if (vistos.has(id_detalle_op)) throw new AppError('No repitas detalles de orden.', 400);
      vistos.add(id_detalle_op);
      const cantidad = numero(linea?.cantidad, `lineas[${indice}].cantidad`);
      if (cantidad <= 0) throw new AppError('La cantidad debe ser mayor que cero.', 400);
      return { id_detalle_op, cantidad };
    });
  }
  return salida;
}

function idOpcional(valor, campo, indice) {
  if (valor == null || valor === '') return null;
  return enteroPositivo(valor, `lineas[${indice}].${campo}`);
}

/** Cada línea lleva un producto insumo (id_insumo) o un producto del menú
 *  (id_producto). Se conserva la resolución de id_insumo sin prefijo para
 *  compatibilidad con clientes anteriores; los nuevos envían id_producto
 *  explícito para evitar colisiones entre los IDs de ambas tablas. */
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
    const tamano = tamanoOpcional(linea?.tamano, indice);
    // Una pizza puede repetirse en la orden con tamaños distintos (Mediana y Grande).
    const clave = id_producto != null
      ? `producto:${id_producto}:${tamano ?? ''}`
      : `insumo:${id_insumo}`;
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
    return { id_insumo, id_producto, cantidad, tamano };
  });
}

export function validarCrearOrdenProduccion(body) {
  const entrada = body || {};
  if (entrada.tipo !== undefined && entrada.tipo !== 'Preparacion') {
    throw new AppError("Solo se pueden crear órdenes de tipo 'Preparacion' desde esta ruta.", 400);
  }
  if (entrada.validar_stock !== undefined && typeof entrada.validar_stock !== 'boolean') {
    throw new AppError('El campo validar_stock debe ser booleano.', 400);
  }
  return {
    tipo: 'Preparacion',
    validar_stock: entrada.validar_stock ?? true,
    fecha_solicitada:
      entrada.fecha_solicitada == null || entrada.fecha_solicitada === ''
        ? null
        : validarFecha(entrada.fecha_solicitada),
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

function precioPorcionOpcional(valor, campo) {
  if (valor === undefined || valor === null || (typeof valor === 'string' && !valor.trim())) return undefined;
  const precio = numero(valor, campo);
  if (precio <= 0) throw new AppError(`El campo ${campo} debe ser mayor que cero.`, 400);
  return precio;
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
  const precios = {};
  const precioMediana = precioPorcionOpcional(entrada.precio_mediana, 'precio_mediana');
  const precioGrande = precioPorcionOpcional(entrada.precio_grande, 'precio_grande');
  if (precioMediana !== undefined) precios.precio_mediana = precioMediana;
  if (precioGrande !== undefined) precios.precio_grande = precioGrande;
  if (entrada.precios !== undefined) {
    if (!Array.isArray(entrada.precios)) throw new AppError('El campo precios debe ser un arreglo.', 400);
    const productos = new Set();
    precios.precios = entrada.precios.map((item, indice) => {
      const id_producto = enteroPositivo(item?.id_producto, `precios[${indice}].id_producto`);
      if (productos.has(id_producto)) throw new AppError('No repitas productos en precios.', 400);
      productos.add(id_producto);
      const medianaItem = precioPorcionOpcional(item?.precio_mediana, `precios[${indice}].precio_mediana`);
      const grandeItem = precioPorcionOpcional(item?.precio_grande, `precios[${indice}].precio_grande`);
      return {
        id_producto,
        ...(medianaItem !== undefined ? { precio_mediana: medianaItem } : {}),
        ...(grandeItem !== undefined ? { precio_grande: grandeItem } : {}),
      };
    });
  }
  return {
    ...precios,
    lineas: entrada.lineas.map((linea, indice) => {
      const id_detalle_op = enteroPositivo(linea?.id_detalle_op, `lineas[${indice}].id_detalle_op`);
      if (vistos.has(id_detalle_op)) throw new AppError('No repitas detalles de orden.', 400);
      vistos.add(id_detalle_op);
      const cantidad_real = numero(linea?.cantidad_real, `lineas[${indice}].cantidad_real`);
      if (!Number.isSafeInteger(cantidad_real) || cantidad_real < 0) {
        throw new AppError('La cantidad real debe ser un entero mayor o igual a cero.', 400);
      }
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
