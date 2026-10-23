import { Router } from 'express';
import { verificarToken } from '../middlewares/auth.js';
import { requierePermiso } from '../middlewares/permisos.js';
import { requiereAlgunPermiso } from '../middlewares/permisosMultiples.js';
import {
  cambiarEstadoInsumoController,
  crearInsumoController,
  eliminarInsumoController,
  listarCategoriasInsumoController,
  listarInsumosController,
  obtenerInsumoController,
  actualizarInsumoController,
} from '../controllers/insumos.controller.js';

const router = Router();

const PERMISOS_LECTURA_INSUMOS = [
  { modulo: 'Compras', nombre: 'Insumos', privilegio: 'Ver' },
  { modulo: 'Producción', nombre: 'Productos', privilegio: 'Ver' },
  { modulo: 'Producción', nombre: 'Orden de Producción', privilegio: 'Ver' },
];

router.get(
  '/categorias-insumos',
  verificarToken,
  requiereAlgunPermiso([
    { modulo: 'Compras', nombre: 'Insumos', privilegio: 'Ver' },
    { modulo: 'Compras', nombre: 'Compra', privilegio: 'Crear' },
    { modulo: 'Compras', nombre: 'Orden de Compra', privilegio: 'Ver' },
  ]),
  listarCategoriasInsumoController
);
router.get('/insumos', verificarToken, requiereAlgunPermiso(PERMISOS_LECTURA_INSUMOS), listarInsumosController);
router.get('/insumos/:id', verificarToken, requiereAlgunPermiso(PERMISOS_LECTURA_INSUMOS), obtenerInsumoController);
router.post(
  '/insumos',
  verificarToken,
  requierePermiso({ modulo: 'Compras', nombre: 'Insumos', privilegio: 'Crear', mensaje: 'No tienes permiso para crear insumos.' }),
  crearInsumoController
);
router.put(
  '/insumos/:id',
  verificarToken,
  requierePermiso({ modulo: 'Compras', nombre: 'Insumos', privilegio: 'Editar', mensaje: 'No tienes permiso para editar insumos.' }),
  actualizarInsumoController
);
router.patch(
  '/insumos/:id/estado',
  verificarToken,
  requierePermiso({ modulo: 'Compras', nombre: 'Insumos', privilegio: 'Editar', mensaje: 'No tienes permiso para editar insumos.' }),
  cambiarEstadoInsumoController
);
router.delete(
  '/insumos/:id',
  verificarToken,
  requierePermiso({ modulo: 'Compras', nombre: 'Insumos', privilegio: 'Eliminar', mensaje: 'No tienes permiso para eliminar insumos.' }),
  eliminarInsumoController
);

export default router;
