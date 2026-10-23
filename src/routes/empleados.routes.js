import { Router } from 'express';
import { verificarToken } from '../middlewares/auth.js';
import { requierePermiso } from '../middlewares/permisos.js';
import {
  validarCrearEmpleado,
  validarDocumentoId,
} from '../validators/empleados.validator.js';
import {
  crearEmpleadoControlador,
  invitacionesPendientesControlador,
  reenviarInvitacionControlador,
} from '../controllers/empleados.controller.js';

const router = Router();

// Alta de empleado con invitación por correo (Producción → Empleados).
router.post(
  '/empleados',
  verificarToken,
  requierePermiso({
    modulo: 'Producción',
    nombre: 'Empleados',
    privilegio: 'Crear',
    mensaje: 'No tienes permiso para crear empleados.',
  }),
  validarCrearEmpleado,
  crearEmpleadoControlador
);

// Reenvío de la invitación (token nuevo, el anterior deja de servir).
router.post(
  '/empleados/:id/reenviar-invitacion',
  verificarToken,
  requierePermiso({
    modulo: 'Producción',
    nombre: 'Empleados',
    privilegio: 'Editar',
    mensaje: 'No tienes permiso para reenviar invitaciones.',
  }),
  validarDocumentoId,
  reenviarInvitacionControlador
);

// Documentos con invitación pendiente (para mostrar "Reenviar invitación").
router.get(
  '/empleados/invitaciones',
  verificarToken,
  requierePermiso({
    modulo: 'Producción',
    nombre: 'Empleados',
    privilegio: 'Ver',
    mensaje: 'No puedes ver las invitaciones de empleados.',
  }),
  invitacionesPendientesControlador
);

export default router;
