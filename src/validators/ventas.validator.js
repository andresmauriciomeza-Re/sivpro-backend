import AppError from '../errors/AppError.js';

const TIPOS_PAGO = ['Nequi', 'Bancolombia', 'Efectivo'];

/** Motivos fijos de rechazo de pago. El cuarto ("Otro") no viaja solo: el
    frontend lo envía siempre como `Otro: <texto>` y aquí se valida igual. */
const MOTIVOS_RECHAZO = [
  'Comprobante falso',
  'La imagen no corresponde a un comprobante',
  'Comprobante borroso',
];

/** Motivos fijos de anulación desde el listado del panel (mismos que ofrece
    el frontend en `MOTIVOS_ANULACION`). */
const MOTIVOS_ANULACION = [
  'Cliente canceló el pedido',
  'Error al registrar el pedido',
  'Producto no disponible',
];

const MOTIVO_OTRO = 'Otro';
const MOTIVO_OTRO_MAX = 80;

/** Núcleo común de los motivos: lista fija o `Otro: <texto>` obligatorio de
    hasta 80 caracteres. Devuelve el valor ya normalizado, que se guarda en
    tb_venta.motivo_rechazo (varchar 100: "Otro: " + 80 = 86). */
function validarMotivoConOtro(valor, motivos, { campo, mensaje }) {
  const motivo = texto(valor, campo, 100);
  if (motivos.includes(motivo)) return motivo;
  const prefijo = `${MOTIVO_OTRO}:`;
  if (motivo.startsWith(prefijo)) {
    const detalle = motivo.slice(prefijo.length).trim();
    if (!detalle) throw new AppError('El detalle del motivo "Otro" es obligatorio.', 400);
    if (detalle.length > MOTIVO_OTRO_MAX) {
      throw new AppError(`El detalle del motivo "Otro" no puede superar ${MOTIVO_OTRO_MAX} caracteres.`, 400);
    }
    return `${MOTIVO_OTRO}: ${detalle}`;
  }
  throw new AppError(mensaje, 400);
}

/** Valida el motivo de rechazo que llega del panel de verificación. */
export function validarMotivoRechazo(valor) {
  return validarMotivoConOtro(valor, MOTIVOS_RECHAZO, {
    campo: 'motivo_rechazo',
    mensaje: 'El motivo de rechazo no es válido.',
  });
}

/** Valida el motivo de una anulación hecha por el panel. */
export function validarMotivoAnulacion(valor) {
  return validarMotivoConOtro(valor, MOTIVOS_ANULACION, {
    campo: 'motivo',
    mensaje: 'El motivo de anulación no es válido.',
  });
}

function texto(valor, campo, max = 255) {
  if (typeof valor !== 'string' || !valor.trim() || valor.trim().length > max) {
    throw new AppError(`El campo ${campo} es obligatorio y no puede superar ${max} caracteres.`, 400);
  }
  return valor.trim();
}

function horaValida(hora) {
  return typeof hora === 'string' && /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(hora);
}

function validarLineas(lineas) {
  if (!Array.isArray(lineas) || lineas.length === 0 || lineas.length > 100) {
    throw new AppError('La venta debe incluir entre 1 y 100 productos.', 400);
  }
  const vistos = new Set();
  return lineas.map((linea) => {
    const idProducto = Number(linea?.id_producto);
    const cantidad = Number(linea?.cantidad);
    if (!Number.isSafeInteger(idProducto) || idProducto <= 0) {
      throw new AppError('Cada producto debe tener un id_producto numérico válido.', 400);
    }
    if (!Number.isSafeInteger(cantidad) || cantidad <= 0) {
      throw new AppError('La cantidad de cada producto debe ser un entero mayor que cero.', 400);
    }
    if (vistos.has(idProducto)) throw new AppError('No repitas productos en las líneas; consolida su cantidad.', 400);
    vistos.add(idProducto);
    const tamano = linea?.tamano == null || linea.tamano === '' ? null : texto(linea.tamano, 'tamano', 20);
    return { idProducto, cantidad, tamano };
  });
}

function validarHoraRecogida(hora) {
  if (!horaValida(hora)) throw new AppError('La hora de recogida debe tener formato HH:mm.', 400);
  const [h, m] = hora.split(':').map(Number);
  if (h < 12) throw new AppError('La hora de recogida debe ser en horario PM.', 400);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}
function validarPago(pago, { panel = false } = {}) {
  const tipo = texto(pago?.tipo, 'tipo de pago', 30);
  if (!TIPOS_PAGO.includes(tipo) || (!panel && tipo === 'Efectivo')) {
    throw new AppError('El tipo de pago no es válido para este canal.', 400);
  }
  const comprobante = pago?.comprobante == null ? null : texto(pago.comprobante, 'comprobante', 2048);
  if (!panel && !comprobante) throw new AppError('El comprobante de pago es obligatorio.', 400);
  return { tipo, comprobante };
}

export function validarCrearVenta(body, opciones = {}) {
  // El formulario del panel ya no pide hora de recogida: ahí, si no viene, el
  // servicio auto-asigna "ahora + MINUTOS_PREPARACION_PANEL" (pedido tomado en
  // el local). En el checkout del cliente la hora sigue siendo obligatoria.
  let horaRecogida = null;
  if (body?.hora_recogida != null && body.hora_recogida !== '') {
    horaRecogida = validarHoraRecogida(body.hora_recogida);
  } else if (!opciones.panel) {
    throw new AppError('La hora de recogida es obligatoria.', 400);
  }
  const lineas = validarLineas(body?.productos);
  const pago = validarPago(body?.pago, opciones);
  return { horaRecogida, lineas, pago };
}

export function validarVerificacion(body) {
  const accion = body?.accion;
  if (!['aceptar', 'monto_faltante', 'rechazar'].includes(accion)) {
    throw new AppError('La acción debe ser aceptar, monto_faltante o rechazar.', 400);
  }
  if (accion === 'monto_faltante') {
    const pagado = Number(body.pagado);
    if (!Number.isFinite(pagado) || pagado < 0) throw new AppError('El monto pagado debe ser mayor o igual a cero.', 400);
    return { accion, pagado };
  }
  if (accion === 'rechazar') {
    return { accion, motivo: validarMotivoRechazo(body.motivo_rechazo) };
  }
  return { accion };
}

/** Anulación desde el listado del panel: motivo obligatorio (los tres fijos
    o "Otro: <texto>") y comprobante de la devolución OPCIONAL (la subida a
    Cloudinary la hace el frontend; aquí sólo se controla el largo de la
    columna tb_venta.comprobante_anulacion, varchar 500). */
export function validarAnulacion(body) {
  const motivo = validarMotivoAnulacion(body?.motivo);
  const comprobante = body?.comprobante == null || body.comprobante === ''
    ? null
    : texto(body.comprobante, 'comprobante', 500);
  return { motivo, comprobante };
}

export function validarComprobante(body) {
  const comprobante = texto(body?.comprobante, 'comprobante', 2048);
  const tipo = texto(body?.tipo, 'tipo de pago', 30);
  if (!['Nequi', 'Bancolombia'].includes(tipo)) throw new AppError('El tipo de pago no es válido.', 400);
  return { comprobante, tipo };
}

export function validarClientePanel(body) {
  const cliente = body?.cliente;
  const tipoDocumento = texto(cliente?.tipo_documento, 'tipo_documento', 20);
  if (!['CC', 'CE', 'Pasaporte'].includes(tipoDocumento)) throw new AppError('El tipo de documento no es válido.', 400);
  const numeroDocumento = texto(cliente?.numero_documento, 'numero_documento', 15);
  if (!/^\d{5,15}$/.test(numeroDocumento)) throw new AppError('El número de documento debe tener entre 5 y 15 dígitos.', 400);
  return {
    tipoDocumento,
    numeroDocumento,
    nombre: texto(cliente?.nombre, 'nombre', 100),
  };
}

/** Motivos de devolución por línea: los mismos que valida el CHECK
    `ck_ddev_motivo` de tb_detalle_devolucion. "Otro" exige descripción
    (CHECK `ck_ddev_otro`). */
const MOTIVOS_DEVOLUCION = ['Producto malo', 'Producto incorrecto', 'Cambio de sabor', 'Otro'];

/** Resolución de una devolución: qué se devuelve por línea y qué canje se da
    al cliente. `canje` vacío = todo en dinero. */
export function validarResolverDevolucion(body) {
  const tipo = texto(body?.tipo, 'tipo', 20);
  if (!['Dinero', 'Producto', 'Excedente', 'Devuelta'].includes(tipo)) {
    throw new AppError('El tipo de devolución no es válido.', 400);
  }
  const nota = body?.nota == null || body.nota === '' ? null : texto(body.nota, 'nota', 500);

  if (!Array.isArray(body?.lineas) || body.lineas.length === 0 || body.lineas.length > 100) {
    throw new AppError('La devolución debe incluir al menos una línea devuelta.', 400);
  }
  const lineas = body.lineas.map((linea, indice) => {
    const idDetalleVenta = Number(linea?.id_detalle_venta);
    if (!Number.isSafeInteger(idDetalleVenta) || idDetalleVenta <= 0) {
      throw new AppError(`La línea ${indice + 1} no tiene un detalle de venta válido.`, 400);
    }
    const cantidad = Number(linea?.cantidad);
    if (!Number.isSafeInteger(cantidad) || cantidad <= 0) {
      throw new AppError(`La cantidad devuelta de la línea ${indice + 1} debe ser un entero mayor que cero.`, 400);
    }
    const motivo = texto(linea?.motivo, `motivo de la línea ${indice + 1}`, 100);
    if (!MOTIVOS_DEVOLUCION.includes(motivo)) {
      throw new AppError(`El motivo de la línea ${indice + 1} no es válido.`, 400);
    }
    const descripcionMotivo = motivo === 'Otro'
      ? texto(linea?.descripcion_motivo, `descripción del motivo de la línea ${indice + 1}`, 255)
      : (linea?.descripcion_motivo == null || linea.descripcion_motivo === '' ? null : texto(linea.descripcion_motivo, 'descripcion_motivo', 255));
    // El canje se guarda por línea: id y cantidad van juntos (ck_ddev_reemplazo).
    const idProductoReemplazo = linea?.id_producto_reemplazo == null ? null : Number(linea.id_producto_reemplazo);
    const cantidadReemplazo = linea?.cantidad_reemplazo == null ? null : Number(linea.cantidad_reemplazo);
    if ((idProductoReemplazo == null) !== (cantidadReemplazo == null)) {
      throw new AppError(`El canje de la línea ${indice + 1} debe llevar producto y cantidad juntos.`, 400);
    }
    if (idProductoReemplazo != null) {
      if (!Number.isSafeInteger(idProductoReemplazo) || idProductoReemplazo <= 0) {
        throw new AppError(`El producto de canje de la línea ${indice + 1} no es válido.`, 400);
      }
      if (!Number.isSafeInteger(cantidadReemplazo) || cantidadReemplazo <= 0) {
        throw new AppError(`La cantidad de canje de la línea ${indice + 1} debe ser un entero mayor que cero.`, 400);
      }
    }
    const tamanoReemplazo = linea?.tamano_reemplazo == null || linea.tamano_reemplazo === ''
      ? null : texto(linea.tamano_reemplazo, 'tamano_reemplazo', 20);
    return { idDetalleVenta, cantidad, motivo, descripcionMotivo, idProductoReemplazo, cantidadReemplazo, tamanoReemplazo };
  });

  // Canje total para la venta de reemplazo (los productos que recibe el
  // cliente). Se arma desde las líneas con producto de canje.
  const canje = body?.canje == null ? [] : body.canje.map((linea, indice) => {
    const idProducto = Number(linea?.id_producto);
    if (!Number.isSafeInteger(idProducto) || idProducto <= 0) {
      throw new AppError(`El producto de canje ${indice + 1} no es válido.`, 400);
    }
    const cantidad = Number(linea?.cantidad);
    if (!Number.isSafeInteger(cantidad) || cantidad <= 0) {
      throw new AppError(`La cantidad del canje ${indice + 1} debe ser un entero mayor que cero.`, 400);
    }
    const tamano = linea?.tamano == null || linea.tamano === '' ? null : texto(linea.tamano, 'tamano', 20);
    return { idProducto, cantidad, tamano };
  });

  const monto = Number(body?.monto ?? 0);
  if (!Number.isFinite(monto) || monto < 0) {
    throw new AppError('El monto de la devolución debe ser mayor o igual a cero.', 400);
  }
  return { tipo, nota, lineas, canje, monto };
}
