import { Router } from 'express';
import { verificarToken } from '../middlewares/auth.js';
import { requierePermiso } from '../middlewares/permisos.js';
import {
  anularCompraController,
  crearCompraController,
  listarComprasController,
  obtenerCompraController,
} from '../controllers/compras.controller.js';

const router = Router();
const permisoCompra = (privilegio) => requierePermiso({
  modulo: 'Compras',
  nombre: 'Compra',
  privilegio,
  mensaje: `No tienes permiso para ${privilegio.toLowerCase()} compras.`,
});

router.get('/compras', verificarToken, permisoCompra('Ver'), listarComprasController);
router.get('/compras/:id', verificarToken, permisoCompra('Ver'), obtenerCompraController);
router.post('/compras', verificarToken, permisoCompra('Crear'), crearCompraController);
router.patch('/compras/:id/anular', verificarToken, permisoCompra('Editar'), anularCompraController);

export default router;
