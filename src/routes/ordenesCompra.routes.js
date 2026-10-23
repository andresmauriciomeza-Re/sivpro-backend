import { Router } from 'express';
import { verificarToken } from '../middlewares/auth.js';
import { requierePermiso } from '../middlewares/permisos.js';
import { requiereAlgunPermiso } from '../middlewares/permisosMultiples.js';
import {
  actualizarOrdenCompraController,
  cambiarEstadoOrdenCompraController,
  crearOrdenCompraController,
  listarOrdenesCompraController,
  obtenerOrdenCompraController,
  recibirOrdenCompraController,
} from '../controllers/ordenesCompra.controller.js';

const router = Router();
const permisoOrdenCompra = (privilegio) => requierePermiso({
  modulo: 'Compras',
  nombre: 'Orden de Compra',
  privilegio,
  mensaje: `No tienes permiso para ${privilegio.toLowerCase()} órdenes de compra.`,
});
const permisoLectura = requiereAlgunPermiso([
  { modulo: 'Compras', nombre: 'Orden de Compra', privilegio: 'Ver' },
  { modulo: 'Compras', nombre: 'Compra', privilegio: 'Ver' },
]);

router.get('/ordenes-compra', verificarToken, permisoLectura, listarOrdenesCompraController);
router.get('/ordenes-compra/:id', verificarToken, permisoLectura, obtenerOrdenCompraController);
router.post('/ordenes-compra', verificarToken, permisoOrdenCompra('Crear'), crearOrdenCompraController);
router.put('/ordenes-compra/:id', verificarToken, permisoOrdenCompra('Editar'), actualizarOrdenCompraController);
router.patch('/ordenes-compra/:id/estado', verificarToken, permisoOrdenCompra('Editar'), cambiarEstadoOrdenCompraController);
router.post(
  '/ordenes-compra/:id/recepcion',
  verificarToken,
  requierePermiso({ modulo: 'Compras', nombre: 'Compra', privilegio: 'Crear', mensaje: 'No tienes permiso para recibir compras.' }),
  recibirOrdenCompraController
);

export default router;
