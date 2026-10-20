import AppError from '../errors/AppError.js';

const TIPOS_PAGO = ['Nequi', 'Bancolombia', 'Efectivo'];
const MOTIVOS_RECHAZO = ['Comprobante falso', 'Dinero faltante'];

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
  const horaRecogida = validarHoraRecogida(body?.hora_recogida);
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
    const motivo = texto(body.motivo_rechazo, 'motivo_rechazo', 100);
    if (!MOTIVOS_RECHAZO.includes(motivo)) throw new AppError('El motivo de rechazo no es válido.', 400);
    return { accion, motivo };
  }
  return { accion };
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
