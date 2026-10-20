import { Router } from 'express';
import { verificarToken } from '../middlewares/auth.js';
import { requierePermiso } from '../middlewares/permisos.js';
import {
  cambiarEstadoRolControlador,
  crearRolControlador,
  editarRolControlador,
  eliminarRolControlador,
  obtenerPermisos,
  obtenerRoles,
} from '../controllers/roles.controller.js';

const router = Router();
const requiereRoles = privilegio => requierePermiso({
  modulo: 'Configuración',
  nombre: 'Roles',
  privilegio,
  mensaje: `No tienes permiso para ${privilegio.toLowerCase()} roles.`,
});

router.get('/permisos', verificarToken, requiereRoles('Ver'), obtenerPermisos);
router.get('/roles', verificarToken, requiereRoles('Ver'), obtenerRoles);
router.post('/roles', verificarToken, requiereRoles('Crear'), crearRolControlador);
router.put('/roles/:id', verificarToken, requiereRoles('Editar'), editarRolControlador);
router.patch('/roles/:id/estado', verificarToken, requiereRoles('Editar'), cambiarEstadoRolControlador);
router.delete('/roles/:id', verificarToken, requiereRoles('Eliminar'), eliminarRolControlador);

export default router;
