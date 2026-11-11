import { Router } from 'express';
import { verificarToken } from '../middlewares/auth.js';
import { requierePermiso } from '../middlewares/permisos.js';
import { requiereAlgunPermiso } from '../middlewares/permisosMultiples.js';
import {
  cambiarEstadoInsumoController,
  crearInsumoController,
  eliminarInsumoController,
  guardarPresentacionController,
  listarCategoriasInsumoController,
  listarInsumosController,
  listarPresentacionesController,
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
// Presentaciones de compra del insumo (regla 2.2): permisos del módulo
// Compras para que el formulario de Compra/OC pueda configurar el factor
// sin depender de los permisos de pantalla de Insumos.
router.get(
  '/insumos/:id/presentaciones',
  verificarToken,
  requiereAlgunPermiso([
    { modulo: 'Compras', nombre: 'Insumos', privilegio: 'Ver' },
    { modulo: 'Compras', nombre: 'Compra', privilegio: 'Crear' },
    { modulo: 'Compras', nombre: 'Orden de Compra', privilegio: 'Ver' },
    { modulo: 'Compras', nombre: 'Orden de Compra', privilegio: 'Crear' },
  ]),
  listarPresentacionesController
);
router.post(
  '/insumos/:id/presentaciones',
  verificarToken,
  requiereAlgunPermiso(
    [
      { modulo: 'Compras', nombre: 'Insumos', privilegio: 'Editar' },
      { modulo: 'Compras', nombre: 'Compra', privilegio: 'Crear' },
      { modulo: 'Compras', nombre: 'Orden de Compra', privilegio: 'Crear' },
    ],
    'No tienes permiso para editar las presentaciones de insumos.'
  ),
  guardarPresentacionController
);
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
