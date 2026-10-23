import { Router } from 'express';
import { verificarToken } from '../middlewares/auth.js';
import { requiereAlgunPermiso } from '../middlewares/permisosMultiples.js';
import { crearFichaController, listarFichasController, listarFichasVigentesController } from '../controllers/fichas.controller.js';

const router = Router();

router.get(
  '/fichas/vigentes',
  verificarToken,
  requiereAlgunPermiso([
    { modulo: 'Producción', nombre: 'Productos', privilegio: 'Ver' },
    { modulo: 'Compras', nombre: 'Insumos', privilegio: 'Ver' },
    { modulo: 'Producción', nombre: 'Orden de Producción', privilegio: 'Ver' },
  ]),
  listarFichasVigentesController
);
router.get('/fichas', verificarToken, listarFichasController);
router.post('/fichas', verificarToken, crearFichaController);

export default router;
