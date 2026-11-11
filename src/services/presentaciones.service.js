import AppError from '../errors/AppError.js';
import { query } from '../config/db.js';
import { convertirABase, PRESENTACIONES_COMPRA } from '../utils/compras.js';

function mapearPresentacion(row) {
  return {
    id_presentacion: Number(row.id_presentacion),
    id_insumo: Number(row.id_insumo),
    presentacion: row.presentacion,
    unidades_base: Number(row.unidades_base),
    estado: row.estado,
  };
}

async function validarInsumoExistente(idInsumo) {
  const { rows } = await query('SELECT id_insumo, nombre FROM tb_insumo WHERE id_insumo = $1', [idInsumo]);
  if (!rows[0]) throw new AppError('Insumo no encontrado.', 404);
  return rows[0];
}

/**
 * Presentaciones de compra configuradas para un insumo (regla 2.2):
 * cuántas unidades base trae cada paca/caja/sixpack, etc.
 */
export async function listarPresentaciones(idInsumo) {
  await validarInsumoExistente(idInsumo);
  const { rows } = await query(
    `SELECT id_presentacion, id_insumo, presentacion, unidades_base, estado
       FROM tb_insumo_presentacion
      WHERE id_insumo = $1
      ORDER BY presentacion`,
    [idInsumo]
  );
  return rows.map(mapearPresentacion);
}

/**
 * Crea o actualiza una presentación del insumo (upsert por
 * (id_insumo, presentacion)). Se usa desde Compras/Orden de Compra para
 * configurar el factor cuando el usuario compra una presentación nueva.
 */
export async function guardarPresentacion(idInsumo, datos) {
  await validarInsumoExistente(idInsumo);
  const { rows } = await query(
    `INSERT INTO tb_insumo_presentacion (id_insumo, presentacion, unidades_base, estado)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id_insumo, presentacion)
     DO UPDATE SET unidades_base = EXCLUDED.unidades_base,
                   estado = EXCLUDED.estado
     RETURNING id_presentacion, id_insumo, presentacion, unidades_base, estado`,
    [idInsumo, datos.presentacion, datos.unidades_base, datos.estado]
  );
  return mapearPresentacion(rows[0]);
}

/**
 * Convierte la cantidad comprada a la unidad base del insumo (regla 2.2),
 * resolviendo el factor de presentación:
 *
 * 1. misma unidad (comparando sin distinguir mayúsculas) → factor 1;
 * 2. presentación con `factor_presentacion` en el propio ítem (proporcionado
 *    en la petición) → se usa ese factor;
 * 3. presentación sin factor en el ítem → se busca en tb_insumo_presentacion;
 * 4. sin factor configurado o medida incompatible → convertirABase lanza 400.
 *
 * @param {{query: Function}} client transacción o pool de consulta.
 * @param {{cantidad: number, medida: string, factor_presentacion?: number}} item
 * @param {{id_insumo?: number, nombre: string, unidad_medida: string}} insumo
 * @returns {Promise<{unidadesBase: number, unidadBase: string}>}
 */
export async function convertirItemABase(client, item, insumo) {
  const unidadBase = String(insumo.unidad_medida ?? '').trim();
  const medida = String(item.medida ?? '').trim();
  const nombre = insumo.nombre ?? 'el insumo';
  if (!unidadBase) throw new AppError(`El insumo «${nombre}» no tiene unidad de medida configurada.`, 400);
  if (!medida) throw new AppError(`La medida del insumo «${nombre}» es obligatoria.`, 400);

  // Misma unidad (retrocompatible con mayúsculas/minúsculas): factor 1.
  if (medida.toLowerCase() === unidadBase.toLowerCase()) {
    const unidadesBase = convertirABase({ cantidad: item.cantidad, medida, unidadBase: medida, nombre });
    return { unidadesBase, unidadBase };
  }

  let factor = null;
  if (PRESENTACIONES_COMPRA.includes(medida)) {
    if (item.factor_presentacion != null && item.factor_presentacion !== '') {
      factor = Number(item.factor_presentacion);
    } else {
      const { rows } = await client.query(
        `SELECT unidades_base
           FROM tb_insumo_presentacion
          WHERE id_insumo = $1
            AND presentacion = $2
            AND estado = TRUE`,
        [insumo.id_insumo ?? item.id_insumo, medida]
      );
      factor = rows[0] ? Number(rows[0].unidades_base) : null;
    }
  }

  const unidadesBase = convertirABase({
    cantidad: item.cantidad,
    medida,
    unidadBase,
    factorPresentacion: factor,
    nombre,
  });
  return { unidadesBase, unidadBase };
}
