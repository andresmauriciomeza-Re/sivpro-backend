import { Router } from 'express';
import { verificarToken } from '../middlewares/auth.js';
import { requierePermiso } from '../middlewares/permisos.js';
import {
  actualizarProductoNoConformeController,
  completarProductoNoConformeController,
  crearProductoNoConformeController,
  eliminarProductoNoConformeController,
  listarProductosNoConformesController,
  obtenerProductoNoConformeController,
} from '../controllers/productosNoConformes.controller.js';

const router = Router();
const permisoCpn = (privilegio) => requierePermiso({
  modulo: 'Producción',
  nombre: 'Producto No Conforme',
  privilegio,
  mensaje: `No tienes permiso para ${privilegio.toLowerCase()} productos no conformes.`,
});

router.get('/productos-no-conformes', verificarToken, permisoCpn('Ver'), listarProductosNoConformesController);
router.get('/productos-no-conformes/:id', verificarToken, permisoCpn('Ver'), obtenerProductoNoConformeController);
router.post('/productos-no-conformes', verificarToken, permisoCpn('Crear'), crearProductoNoConformeController);
router.put('/productos-no-conformes/:id', verificarToken, permisoCpn('Editar'), actualizarProductoNoConformeController);
router.patch('/productos-no-conformes/:id/estado', verificarToken, permisoCpn('Editar'), completarProductoNoConformeController);
router.delete('/productos-no-conformes/:id', verificarToken, permisoCpn('Eliminar'), eliminarProductoNoConformeController);

export default router;
