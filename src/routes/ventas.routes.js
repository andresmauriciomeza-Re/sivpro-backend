import { Router } from 'express';
import { verificarToken } from '../middlewares/auth.js';
import { requierePermiso } from '../middlewares/permisos.js';
import {
  anularVentaController,
  cancelarVentaClienteController,
  crearVentaClienteController,
  crearVentaPanelController,
  listarMisVentasController,
  listarVentasController,
  marcarDevolucionController,
  obtenerVentaController,
  resolverDevolucionController,
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
// Cancelación del CLIENTE desde "Mis pedidos": sólo verificarToken (el
// servicio valida que la venta sea del token y que esté en los 10 minutos).
router.patch('/ventas/:id/cancelar', verificarToken, cancelarVentaClienteController);
// Devoluciones: marcar la venta como devuelta y resolverla (con canje, que
// crea la venta nueva del cliente + su orden de producción).
router.patch('/ventas/:id/devolucion', verificarToken, permisoVentas('Editar'), marcarDevolucionController);
router.patch('/devoluciones/:id/resolver', verificarToken, permisoVentas('Editar'), resolverDevolucionController);
// Anulación desde el listado del panel: Ventas → Ventas → Editar.
router.patch('/ventas/:id/anular', verificarToken, permisoVentas('Editar'), anularVentaController);
router.post('/ventas/:id/comprobantes', verificarToken, subirComprobanteController);

export default router;
