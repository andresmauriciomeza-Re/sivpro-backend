import { Router } from 'express';
import { verificarToken } from '../middlewares/auth.js';
import { requierePermiso } from '../middlewares/permisos.js';
import { requiereAlgunPermiso } from '../middlewares/permisosMultiples.js';
import {
  actualizarProveedorController,
  cambiarEstadoProveedorController,
  crearProveedorController,
  eliminarProveedorController,
  listarProveedoresController,
  obtenerProveedorController,
} from '../controllers/proveedores.controller.js';

const router = Router();
const permisoProveedores = (privilegio) => requierePermiso({
  modulo: 'Compras',
  nombre: 'Proveedores',
  privilegio,
  mensaje: `No tienes permiso para ${privilegio.toLowerCase()} proveedores.`,
});

const permisosLectura = [
  { modulo: 'Compras', nombre: 'Proveedores', privilegio: 'Ver' },
  { modulo: 'Compras', nombre: 'Orden de Compra', privilegio: 'Ver' },
  { modulo: 'Compras', nombre: 'Compra', privilegio: 'Ver' },
];

const permisosCreacion = [
  { modulo: 'Compras', nombre: 'Proveedores', privilegio: 'Crear' },
  { modulo: 'Compras', nombre: 'Orden de Compra', privilegio: 'Crear' },
  { modulo: 'Compras', nombre: 'Compra', privilegio: 'Crear' },
];

router.get('/proveedores', verificarToken, requiereAlgunPermiso(permisosLectura), listarProveedoresController);
router.get('/proveedores/:id', verificarToken, requiereAlgunPermiso(permisosLectura), obtenerProveedorController);
router.post(
  '/proveedores',
  verificarToken,
  requiereAlgunPermiso(permisosCreacion, 'No tienes permiso para crear proveedores.'),
  crearProveedorController
);
router.put('/proveedores/:id', verificarToken, permisoProveedores('Editar'), actualizarProveedorController);
router.patch('/proveedores/:id/estado', verificarToken, permisoProveedores('Editar'), cambiarEstadoProveedorController);
router.patch('/proveedores/:id', verificarToken, permisoProveedores('Editar'), cambiarEstadoProveedorController);
router.delete('/proveedores/:id', verificarToken, permisoProveedores('Eliminar'), eliminarProveedorController);

export default router;
