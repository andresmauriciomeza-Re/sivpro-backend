import AppError from '../errors/AppError.js';
import { validarPermisoUsuario } from '../middlewares/permisosMultiples.js';
import {
  crearVersionFicha,
  listarFichasPropietario,
  listarFichasVigentes,
  obtenerPropietarioFicha,
} from '../services/fichas.service.js';
import { validarConsultaFichas, validarCrearFicha } from '../validators/fichas.validator.js';

function permisoPropietario(propietario, privilegio) {
  if (propietario.entidad === 'producto') {
    return {
      modulo: 'Producción',
      nombre: 'Productos',
      privilegio,
      mensaje: `No tienes permiso para ${privilegio.toLowerCase()} fichas de productos.`,
    };
  }
  if (propietario.tipo !== 'Producto insumo') {
    throw new AppError('Solo los productos insumo pueden tener ficha técnica propia.', 400);
  }
  return {
    modulo: 'Compras',
    nombre: 'Insumos',
    privilegio,
    mensaje: `No tienes permiso para ${privilegio.toLowerCase()} fichas de productos insumo.`,
  };
}

export async function listarFichasController(req, res, next) {
  try {
    const propietarioId = validarConsultaFichas(req.query);
    const propietario = await obtenerPropietarioFicha(propietarioId);
    const permiso = permisoPropietario(propietario, 'Ver');
    await validarPermisoUsuario(req, permiso, permiso.mensaje);
    res.json(await listarFichasPropietario(propietarioId));
  } catch (error) {
    next(error);
  }
}

export async function listarFichasVigentesController(req, res, next) {
  try {
    res.json(await listarFichasVigentes());
  } catch (error) {
    next(error);
  }
}

export async function crearFichaController(req, res, next) {
  try {
    const datos = validarCrearFicha(req.body);
    const propietario = await obtenerPropietarioFicha(datos);
    const permiso = permisoPropietario(propietario, 'Editar');
    await validarPermisoUsuario(req, permiso, permiso.mensaje);
    const resultado = await crearVersionFicha(datos);
    res.status(resultado.statusCode).json(resultado.ficha);
  } catch (error) {
    next(error);
  }
}
