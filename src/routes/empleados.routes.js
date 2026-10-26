import { Router } from 'express';
import { verificarToken } from '../middlewares/auth.js';
import { requierePermiso } from '../middlewares/permisos.js';
import {
  validarCrearEmpleado,
  validarDocumentoId,
  validarEditarEmpleado,
  validarEstadoEmpleado,
  validarIdEmpleado,
  validarNuevaContratacion,
} from '../validators/empleados.validator.js';
import {
  cambiarEstadoEmpleadoControlador,
  crearContratacionControlador,
  crearEmpleadoControlador,
  editarEmpleadoControlador,
  invitacionesPendientesControlador,
  listarCargosControlador,
  listarEmpleadosControlador,
  miContratacionControlador,
  reenviarInvitacionControlador,
} from '../controllers/empleados.controller.js';

const router = Router();

const permisoEmpleados = (privilegio, mensaje) => requierePermiso({
  modulo: 'Producción',
  nombre: 'Empleados',
  privilegio,
  mensaje,
});

// Listado de empleados con su contratación vigente y el historial.
router.get(
  '/empleados',
  verificarToken,
  permisoEmpleados('Ver', 'No puedes ver los empleados.'),
  listarEmpleadosControlador
);

// Alta de empleado con invitación por correo (Producción → Empleados).
router.post(
  '/empleados',
  verificarToken,
  permisoEmpleados('Crear', 'No tienes permiso para crear empleados.'),
  validarCrearEmpleado,
  crearEmpleadoControlador
);

// Documentos con invitación pendiente (para mostrar "Reenviar invitación").
router.get(
  '/empleados/invitaciones',
  verificarToken,
  permisoEmpleados('Ver', 'No puedes ver las invitaciones de empleados.'),
  invitacionesPendientesControlador
);

// Roles que se pueden asignar como cargo (no depende del permiso de Roles).
router.get(
  '/empleados/cargos',
  verificarToken,
  permisoEmpleados('Ver', 'No puedes ver los cargos disponibles.'),
  listarCargosControlador
);

// Historial de contrataciones de quien tiene la sesión (Mi perfil): solo
// requiere sesión porque cada quien lee únicamente lo suyo.
router.get(
  '/empleados/mi-contratacion',
  verificarToken,
  miContratacionControlador
);

// Reenvío de la invitación (token nuevo, el anterior deja de servir).
// OJO: aquí `:id` es el DOCUMENTO; en las rutas de abajo es el id_empleado.
router.post(
  '/empleados/:id/reenviar-invitacion',
  verificarToken,
  permisoEmpleados('Editar', 'No tienes permiso para reenviar invitaciones.'),
  validarDocumentoId,
  reenviarInvitacionControlador
);

// Desde aquí `:id` es el id_empleado (entero de tb_empleado).
router.put(
  '/empleados/:id',
  verificarToken,
  permisoEmpleados('Editar', 'No tienes permiso para editar empleados.'),
  validarIdEmpleado,
  validarEditarEmpleado,
  editarEmpleadoControlador
);

router.patch(
  '/empleados/:id/estado',
  verificarToken,
  permisoEmpleados('Editar', 'No tienes permiso para cambiar el estado de empleados.'),
  validarIdEmpleado,
  validarEstadoEmpleado,
  cambiarEstadoEmpleadoControlador
);

router.post(
  '/empleados/:id/contrataciones',
  verificarToken,
  permisoEmpleados('Editar', 'No tienes permiso para registrar contrataciones.'),
  validarIdEmpleado,
  validarNuevaContratacion,
  crearContratacionControlador
);

export default router;
