import { Router } from 'express';
import { verificarToken } from '../middlewares/auth.js';
import { requierePermiso } from '../middlewares/permisos.js';
import {
  cambiarEstadoProductoController,
  crearProductoController,
  editarProductoController,
  obtenerCatalogoPublico,
  obtenerCategoriasPublicas,
  obtenerProductosGestion,
  registrarEntradaCompraController,
  revertirCompraController,
} from '../controllers/productos.controller.js';

const router = Router();

router.get('/productos', obtenerCatalogoPublico);
router.get('/categorias-productos', obtenerCategoriasPublicas);
router.get(
  '/productos/gestion',
  verificarToken,
  requierePermiso({
    modulo: 'Producción',
    nombre: 'Productos',
    privilegio: 'Ver',
    mensaje: 'No tienes permiso para ver productos.',
  }),
  obtenerProductosGestion
);

// Mismos módulos y privilegios que ya usa el panel de permisos:
// Producción → Productos y Compras → Compra (roles.service.js).
const permisoProductos = (privilegio) =>
  requierePermiso({
    modulo: 'Producción',
    nombre: 'Productos',
    privilegio,
    mensaje: `No tienes permiso para ${privilegio.toLowerCase()} productos.`,
  });

const permisoCompra = (privilegio) =>
  requierePermiso({
    modulo: 'Compras',
    nombre: 'Compra',
    privilegio,
    mensaje: `No tienes permiso para ${privilegio.toLowerCase()} compras.`,
  });

router.post('/productos', verificarToken, permisoProductos('Crear'), crearProductoController);
router.put('/productos/:id', verificarToken, permisoProductos('Editar'), editarProductoController);
router.patch('/productos/:id/estado', verificarToken, permisoProductos('Editar'), cambiarEstadoProductoController);
router.post('/productos/:id/entrada-compra', verificarToken, permisoCompra('Crear'), registrarEntradaCompraController);
router.post('/productos/:id/reversa-compra', verificarToken, permisoCompra('Editar'), revertirCompraController);

export default router;
