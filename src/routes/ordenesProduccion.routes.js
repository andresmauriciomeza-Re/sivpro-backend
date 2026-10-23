import { Router } from 'express';
import { verificarToken } from '../middlewares/auth.js';
import { requierePermiso } from '../middlewares/permisos.js';
import {
  actualizarOrdenProduccionController,
  completarOrdenProduccionController,
  crearOrdenProduccionController,
  darBajaOrdenProduccionController,
  eliminarOrdenProduccionController,
  iniciarOrdenProduccionController,
  listarOrdenesProduccionController,
  obtenerOrdenProduccionController,
  obtenerRequeridosOrdenProduccionController,
} from '../controllers/ordenesProduccion.controller.js';

const router = Router();
const permisoOrdenes = (privilegio) => requierePermiso({
  modulo: 'Producción',
  nombre: 'Orden de Producción',
  privilegio,
  mensaje: `No tienes permiso para ${privilegio.toLowerCase()} órdenes de producción.`,
});

router.get('/ordenes-produccion', verificarToken, permisoOrdenes('Ver'), listarOrdenesProduccionController);
router.get('/ordenes-produccion/:id/requeridos', verificarToken, permisoOrdenes('Ver'), obtenerRequeridosOrdenProduccionController);
router.get('/ordenes-produccion/:id', verificarToken, permisoOrdenes('Ver'), obtenerOrdenProduccionController);
router.post('/ordenes-produccion', verificarToken, permisoOrdenes('Crear'), crearOrdenProduccionController);
router.put('/ordenes-produccion/:id', verificarToken, permisoOrdenes('Editar'), actualizarOrdenProduccionController);
router.delete('/ordenes-produccion/:id', verificarToken, permisoOrdenes('Eliminar'), eliminarOrdenProduccionController);
router.post('/ordenes-produccion/:id/iniciar', verificarToken, permisoOrdenes('Editar'), iniciarOrdenProduccionController);
router.post('/ordenes-produccion/:id/completar', verificarToken, permisoOrdenes('Editar'), completarOrdenProduccionController);
router.post('/ordenes-produccion/:id/dar-baja', verificarToken, permisoOrdenes('Editar'), darBajaOrdenProduccionController);

export default router;
