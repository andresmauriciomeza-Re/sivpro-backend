import { Router } from 'express';
import { verificarToken } from '../middlewares/auth.js';
import { requierePermiso } from '../middlewares/permisos.js';
import {
  cambiarEstadoCategoriaController,
  crearCategoriaController,
  editarCategoriaController,
  eliminarCategoriaController,
  listarCategoriasGestionController,
} from '../controllers/categoriasProductos.controller.js';

// El GET público /categorias-productos (solo activas) vive en productos.routes.js.
const router = Router();
const permisoCategoria = (privilegio) => requierePermiso({
  modulo: 'Producción',
  nombre: 'Categoría de Producto',
  privilegio,
  mensaje: `No tienes permiso para ${privilegio.toLowerCase()} categorías de producto.`,
});

router.get('/categorias-productos/gestion', verificarToken, permisoCategoria('Ver'), listarCategoriasGestionController);
router.post('/categorias-productos', verificarToken, permisoCategoria('Crear'), crearCategoriaController);
router.put('/categorias-productos/:id', verificarToken, permisoCategoria('Editar'), editarCategoriaController);
router.patch('/categorias-productos/:id/estado', verificarToken, permisoCategoria('Editar'), cambiarEstadoCategoriaController);
router.delete('/categorias-productos/:id', verificarToken, permisoCategoria('Eliminar'), eliminarCategoriaController);

export default router;
