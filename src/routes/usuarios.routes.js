import { Router } from 'express';
import { verificarToken } from '../middlewares/auth.js';
import { requierePermiso } from '../middlewares/permisos.js';
import { borrarUsuario } from '../controllers/usuarios.controller.js';

const router = Router();

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
