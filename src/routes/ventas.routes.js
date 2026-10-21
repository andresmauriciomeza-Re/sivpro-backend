import { Router } from 'express';
import { verificarToken } from '../middlewares/auth.js';
import { requierePermiso } from '../middlewares/permisos.js';
import {
  crearVentaClienteController,
  crearVentaPanelController,
  entregarVentaController,
  listarMisVentasController,
  listarVentasController,
  obtenerVentaController,
  subirComprobanteController,
  verificarVentaController,
} from '../controllers/ventas.controller.js';

const router = Router();
const permisoVentas = (privilegio) => requierePermiso({
  modulo: 'Ventas',
  nombre: 'Ventas',
  privilegio,
  mensaje: `No tienes permiso para ${privilegio.toLowerCase()} ventas.`,
});

router.post('/ventas', verificarToken, crearVentaClienteController);
router.get('/ventas/mias', verificarToken, listarMisVentasController);
router.post('/ventas/panel', verificarToken, permisoVentas('Crear'), crearVentaPanelController);
router.get('/ventas', verificarToken, permisoVentas('Ver'), listarVentasController);
router.get('/ventas/:id', verificarToken, permisoVentas('Ver'), obtenerVentaController);
router.patch('/ventas/:id/verificacion', verificarToken, permisoVentas('Editar'), verificarVentaController);
router.patch('/ventas/:id/entrega', verificarToken, permisoVentas('Editar'), entregarVentaController);
router.post('/ventas/:id/comprobantes', verificarToken, subirComprobanteController);

export default router;
