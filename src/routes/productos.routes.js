import { Router } from 'express';
import { verificarToken } from '../middlewares/auth.js';
import { requierePermiso } from '../middlewares/permisos.js';
import {
  obtenerCatalogoPublico,
  obtenerCategoriasPublicas,
  obtenerProductosGestion,
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

export default router;
