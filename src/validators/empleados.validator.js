import AppError from '../errors/AppError.js';
import { validarDatosPersona } from './auth.validator.js';

// Alta de empleado (POST /empleados): los datos de la persona (teléfono
// OPCIONAL, como en el formulario), el estado de la ficha, los cargos
// (nombres de rol) y los datos de la contratación. Nunca llega contraseña: la
// cuenta se crea con un hash aleatorio y el empleado la define al activarse.
const REGEX_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CARGO = 100;
const REGEX_DOCUMENTO_ID = /^\d{5,15}$/;

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

export function validarCrearEmpleado(req, res, next) {
  const body = req.body || {};
  const persona = validarDatosPersona(body, { telefonoOpcional: true });

  if (typeof body.estado !== 'boolean') {
    throw new AppError('El estado debe ser activo o inactivo.', 400);
  }

  // Los cargos viajan como NOMBRES de rol (los ids locales del panel no son
  // los ids de la base). NUNCA EN SILENCIO: un `cargos` que no sea una lista de
  // textos se rechaza en vez de convertirse en [] (que dejaría al empleado sin
  // sus cargos sin avisar a nadie).
  if (body.cargos !== undefined && !Array.isArray(body.cargos)) {
    throw new AppError('Los cargos deben enviarse como una lista de nombres de rol.', 400);
  }
  const cargos = (body.cargos ?? []).map((cargo, indice) => {
    if (typeof cargo !== 'string' || !cargo.trim()) {
      throw new AppError(`El cargo ${indice + 1} no tiene un nombre válido.`, 400);
    }
    return cargo.trim();
  });
  if (cargos.some((cargo) => cargo.length > MAX_CARGO)) {
    throw new AppError('El nombre de un cargo no es válido.', 400);
  }

  const fechaInicio = validarFecha(body.fechaInicio, 'fecha de inicio', true);
  const fechaFinal = validarFecha(body.fechaFinal, 'fecha final', false);
  if (fechaFinal && fechaFinal < fechaInicio) {
    throw new AppError('La fecha final no puede ser anterior a la fecha de inicio.', 400);
  }

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
