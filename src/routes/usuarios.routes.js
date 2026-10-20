import { Router } from 'express';
import AppError from '../errors/AppError.js';
import { verificarToken } from '../middlewares/auth.js';
import { requierePermiso } from '../middlewares/permisos.js';
import { validarAltaCliente, validarEdicionCliente } from '../validators/auth.validator.js';
import {
  borrarUsuario,
  cambiarEstadoClienteControlador,
  cambiarEstadoUsuarioControlador,
  crearClienteControlador,
  editarClienteControlador,
  obtenerClientePorDocumento,
  obtenerClientes,
  obtenerUsuarios,
} from '../controllers/usuarios.controller.js';

const router = Router();

router.patch('/usuarios/:id/estado', verificarToken, requierePermiso({
  modulo: 'Configuración', nombre: 'Usuarios', privilegio: 'Editar',
  mensaje: 'No tienes permiso para editar usuarios.',
}), (req, res, next) => {
  if (typeof req.body?.estado !== 'boolean') return next(new AppError('El estado debe ser activo o inactivo.', 400));
  next();
}, cambiarEstadoUsuarioControlador);

router.post('/clientes', verificarToken, requierePermiso({ modulo: 'Ventas', nombre: 'Clientes', privilegio: 'Crear', mensaje: 'No tienes permiso para crear clientes.' }), validarAltaCliente, crearClienteControlador);
router.put('/clientes/:id', verificarToken, requierePermiso({ modulo: 'Ventas', nombre: 'Clientes', privilegio: 'Editar', mensaje: 'No tienes permiso para editar clientes.' }), validarEdicionCliente, editarClienteControlador);
router.patch('/clientes/:id/estado', verificarToken, requierePermiso({ modulo: 'Ventas', nombre: 'Clientes', privilegio: 'Editar', mensaje: 'No tienes permiso para editar clientes.' }), (req, res, next) => {
  if (typeof req.body?.estado !== 'boolean') return next(new AppError('El estado debe ser activo o inactivo.', 400));
  next();
}, cambiarEstadoClienteControlador);

router.get(
  '/usuarios',
  verificarToken,
  requierePermiso({
    modulo: 'Configuración',
    nombre: 'Usuarios',
    privilegio: 'Ver',
    mensaje: 'No tienes permiso para ver usuarios.',
  }),
  obtenerUsuarios
);

router.get(
  '/clientes',
  verificarToken,
  requierePermiso({
    modulo: 'Ventas',
    nombre: 'Clientes',
    privilegio: 'Ver',
    mensaje: 'No tienes permiso para ver clientes.',
  }),
  obtenerClientes
);

router.get(
  '/clientes/documento/:numero',
  verificarToken,
  requierePermiso({
    modulo: 'Ventas',
    nombre: 'Ventas',
    privilegio: 'Crear',
    mensaje: 'No tienes permiso para crear ventas.',
  }),
  obtenerClientePorDocumento
);

// Autorización por PERMISO (Usuarios → Eliminar), no por nombre de rol:
// mismos permisos que el login devuelve y que el panel usa para habilitar
// el botón de eliminar.
router.delete(
  '/usuarios/:id',
  verificarToken,
  requierePermiso({
    modulo: 'Configuración',
    nombre: 'Usuarios',
    privilegio: 'Eliminar',
    mensaje: 'No tienes permiso para eliminar usuarios.',
  }),
  borrarUsuario
);

export default router;
