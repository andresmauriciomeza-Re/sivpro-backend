import AppError from '../errors/AppError.js';
import { validarDatosPersona, validarNombreCorreoTelefono } from './auth.validator.js';

// Alta de empleado (POST /empleados): los datos de la persona (teléfono
// OPCIONAL, como en el formulario), el estado de la ficha, los cargos
// (nombres de rol) y los datos de la contratación. Nunca llega contraseña: la
// cuenta se crea con un hash aleatorio y el empleado la define al activarse.
//
// Edición, cambio de estado y nueva contratación usan LISTA BLANCA de campos:
// cualquier otro campo (incluidos el tipo y el número de documento, que no se
// editan) se rechaza en vez de ignorarse en silencio.
const REGEX_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CARGO = 100;
const REGEX_DOCUMENTO_ID = /^\d{5,15}$/;
// id_empleado es un integer de Postgres (hasta 2147483647).
const REGEX_ID_EMPLEADO = /^\d{1,9}$/;

function validarFecha(fecha, etiqueta, requerida) {
  const valor = typeof fecha === 'string' ? fecha.trim() : '';
  if (!valor) {
    if (requerida) throw new AppError(`La ${etiqueta} es obligatoria.`, 400);
    return '';
  }
  const tiempo = Date.parse(`${valor}T00:00:00Z`);
  if (!REGEX_FECHA.test(valor) || Number.isNaN(tiempo)) {
    throw new AppError(`La ${etiqueta} no es válida.`, 400);
  }
  return valor;
}

// Los cargos viajan como NOMBRES de rol (los ids locales del panel no son
// los ids de la base). NUNCA EN SILENCIO: un `cargos` que no sea una lista de
// textos se rechaza en vez de convertirse en [] (que dejaría al empleado sin
// sus cargos sin avisar a nadie).
function validarCargos(valor) {
  if (valor !== undefined && !Array.isArray(valor)) {
    throw new AppError('Los cargos deben enviarse como una lista de nombres de rol.', 400);
  }
  const cargos = (valor ?? []).map((cargo, indice) => {
    if (typeof cargo !== 'string' || !cargo.trim()) {
      throw new AppError(`El cargo ${indice + 1} no tiene un nombre válido.`, 400);
    }
    return cargo.trim();
  });
  if (cargos.some((cargo) => cargo.length > MAX_CARGO)) {
    throw new AppError('El nombre de un cargo no es válido.', 400);
  }
  return cargos;
}

function validarOrdenFechas(fechaInicio, fechaFinal) {
  if (fechaInicio && fechaFinal && fechaFinal < fechaInicio) {
    throw new AppError('La fecha final no puede ser anterior a la fecha de inicio.', 400);
  }
}

function exigirCuerpoConLista(body, permitidos) {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new AppError('La solicitud no es válida.', 400);
  }
  const extra = Object.keys(body).filter((campo) => !permitidos.includes(campo));
  if (extra.length === 0) return;
  if (extra.includes('tipoDocumento') || extra.includes('numeroDocumento')) {
    throw new AppError('El tipo y el número de documento no se pueden editar.', 400);
  }
  throw new AppError('La solicitud tiene campos no permitidos.', 400);
}

export function validarCrearEmpleado(req, res, next) {
  const body = req.body || {};
  const persona = validarDatosPersona(body, { telefonoOpcional: true });

  if (typeof body.estado !== 'boolean') {
    throw new AppError('El estado debe ser activo o inactivo.', 400);
  }

  const cargos = validarCargos(body.cargos);

  const fechaInicio = validarFecha(body.fechaInicio, 'fecha de inicio', true);
  const fechaFinal = validarFecha(body.fechaFinal, 'fecha final', false);
  validarOrdenFechas(fechaInicio, fechaFinal);

  req.body = {
    ...persona,
    estado: body.estado,
    cargos,
    fechaInicio,
    fechaFinal,
  };
  next();
}

/** Documento = id de usuario en tb_usuarios (solo dígitos, 5 a 15). */
export function validarDocumentoId(req, res, next) {
  const id = String(req.params?.id ?? '').trim();
  if (!REGEX_DOCUMENTO_ID.test(id)) {
    throw new AppError('El documento no es válido.', 400);
  }
  req.params.id = id;
  next();
}

/** id_empleado (entero de tb_empleado), NO el documento. Lo usan GET/PUT/PATCH
 *  y las contrataciones. */
export function validarIdEmpleado(req, res, next) {
  const id = String(req.params?.id ?? '').trim();
  if (!REGEX_ID_EMPLEADO.test(id) || Number(id) < 1) {
    throw new AppError('El empleado no es válido.', 400);
  }
  req.params.id = id;
  next();
}

/** PUT /empleados/:id. Nombre, correo y teléfono siempre; cargos y fechas solo
 *  si se envían (se aplican a la contratación abierta). */
export function validarEditarEmpleado(req, res, next) {
  const body = req.body;
  exigirCuerpoConLista(body, ['nombre', 'correo', 'telefono', 'cargos', 'fechaInicio', 'fechaFinal']);

  const contacto = validarNombreCorreoTelefono(body, { telefonoOpcional: true });
  const datos = { ...contacto };

  if (body.cargos !== undefined) datos.cargos = validarCargos(body.cargos);
  if (body.fechaInicio !== undefined) {
    datos.fechaInicio = validarFecha(body.fechaInicio, 'fecha de inicio', true);
  }
  if (body.fechaFinal !== undefined) {
    datos.fechaFinal = validarFecha(body.fechaFinal, 'fecha final', false);
  }
  validarOrdenFechas(datos.fechaInicio, datos.fechaFinal);

  req.body = datos;
  next();
}

/** PATCH /empleados/:id/estado. */
export function validarEstadoEmpleado(req, res, next) {
  const body = req.body;
  exigirCuerpoConLista(body, ['estado']);
  if (typeof body.estado !== 'boolean') {
    throw new AppError('El estado debe ser activo o inactivo.', 400);
  }
  req.body = { estado: body.estado };
  next();
}

/** POST /empleados/:id/contrataciones. */
export function validarNuevaContratacion(req, res, next) {
  const body = req.body;
  exigirCuerpoConLista(body, ['fechaInicio', 'fechaFinal', 'cargos', 'estado']);
  if (typeof body.estado !== 'boolean') {
    throw new AppError('El estado debe ser activo o inactivo.', 400);
  }
  const cargos = validarCargos(body.cargos);
  const fechaInicio = validarFecha(body.fechaInicio, 'fecha de inicio', true);
  const fechaFinal = validarFecha(body.fechaFinal, 'fecha final', false);
  validarOrdenFechas(fechaInicio, fechaFinal);

  req.body = { estado: body.estado, cargos, fechaInicio, fechaFinal };
  next();
}
