import { query, transaction } from '../config/db.js';
import { MINUTOS_CALENTAMIENTO_PEDIDO } from '../config/produccion.js';
import { ESTADOS_VENTA, MINUTOS_COMPLETAR_VENTA_LOCAL, ZONA_HORARIA_NEGOCIO } from '../config/ventas.js';
import { notificarEstadoPedido } from './pedidoEmail.service.js';

const ordenVencida = (alias, zona) =>
  `${alias}.fecha_en_proceso + interval '${MINUTOS_CALENTAMIENTO_PEDIDO} minutes' <= now() AT TIME ZONE ${zona}::text`;

const pedidosDeVenta = `op.id_venta = tb_venta.id_venta AND op.tipo = 'Pedido'`;
const tienePedidos = `EXISTS (SELECT 1 FROM tb_orden_produccion op WHERE ${pedidosDeVenta})`;
const todasCompletadas = `NOT EXISTS (
  SELECT 1 FROM tb_orden_produccion op
   WHERE ${pedidosDeVenta} AND op.estado IS DISTINCT FROM 'Completada'
)`;
const ventaVencida = (zona) => `(
  (venta_local = TRUE AND (
    fecha_estado + interval '${MINUTOS_COMPLETAR_VENTA_LOCAL} minutes' <= now() AT TIME ZONE ${zona}::text
    OR (${tienePedidos} AND ${todasCompletadas})
  ))
  OR (
    venta_local = FALSE AND hora_recogida IS NOT NULL
    AND (fecha::date + hora_recogida + CASE WHEN hora_recogida < fecha::time THEN interval '1 day' ELSE interval '0' END)
        <= now() AT TIME ZONE ${zona}::text
    AND ${todasCompletadas}
  )
)`;

export async function avanzarAutomaticamente({ pedidoListoId = null } = {}) {
  const { ventas, listos } = await transaction(async (client) => {
    // Los cambios manuales toman el mismo bloqueo de venta antes de modificar sus órdenes.
    const { rows: candidatas } = await client.query(
      `SELECT id_venta FROM tb_venta
        WHERE id_venta = $3::int
           OR (estado = $2::text AND ${ventaVencida('$1')})
           OR EXISTS (
             SELECT 1 FROM tb_orden_produccion op
              WHERE ${pedidosDeVenta} AND op.estado = 'En proceso' AND ${ordenVencida('op', '$1')}
           )
        ORDER BY id_venta FOR NO KEY UPDATE`,
      [ZONA_HORARIA_NEGOCIO, ESTADOS_VENTA.POR_ENTREGAR, pedidoListoId],
    );
    const idsVentas = candidatas.map(({ id_venta }) => id_venta);
    const { rows: ordenes } = await client.query(
      `WITH completadas AS (
         UPDATE tb_orden_produccion
            SET estado = 'Completada',
                fecha_completada = now() AT TIME ZONE $1::text,
                historial = COALESCE(historial::jsonb, '[]'::jsonb) || jsonb_build_array(
                  jsonb_build_object('de', 'En proceso', 'a', 'Completada',
                    'fechaHora', to_char(now() AT TIME ZONE $1::text, 'YYYY-MM-DD"T"HH24:MI:SS'),
                    'automatico', TRUE))
          WHERE tipo = 'Pedido' AND estado = 'En proceso'
            AND ${ordenVencida('tb_orden_produccion', '$1')}
            AND (id_venta IS NULL OR id_venta = ANY($2::int[]))
          RETURNING id_orden_produccion, id_venta
       ), detalles AS (
         UPDATE tb_detalle_orden_produccion d
            SET cantidad_real = d.cantidad_estimada
           FROM completadas op
          WHERE d.id_orden_produccion = op.id_orden_produccion
         RETURNING d.id_detalle_op
       )
       SELECT id_orden_produccion, id_venta FROM completadas`,
      [ZONA_HORARIA_NEGOCIO, idsVentas],
    );
    const { rows: ventas } = await client.query(
      `UPDATE tb_venta
          SET estado = $1::text, fecha_estado = now() AT TIME ZONE $2::text
        WHERE estado = $3::text AND id_venta = ANY($4::int[]) AND ${ventaVencida('$2')}
        RETURNING id_venta`,
      [ESTADOS_VENTA.COMPLETADO, ZONA_HORARIA_NEGOCIO, ESTADOS_VENTA.POR_ENTREGAR, idsVentas],
    );
    const idsListos = ordenes.map(({ id_venta }) => id_venta).filter((id) => id != null);
    if (pedidoListoId != null) idsListos.push(pedidoListoId);
    const { rows: listos } = idsListos.length ? await client.query(
      `SELECT id_venta FROM tb_venta
        WHERE id_venta = ANY($1::int[]) AND estado = $2::text AND venta_local = FALSE
          AND ${tienePedidos} AND ${todasCompletadas}`,
      [idsListos, ESTADOS_VENTA.POR_ENTREGAR],
    ) : { rows: [] };
    return { ventas, listos };
  });

  for (const { id_venta } of ventas) void notificarEstadoPedido(id_venta, 'Completado');
  for (const { id_venta } of listos) void notificarEstadoPedido(id_venta, 'Listo para recoger');
  const { rows: preparaciones } = await query(
    `SELECT id_orden_produccion FROM tb_orden_produccion
      WHERE tipo = 'Preparacion' AND estado = 'En proceso'
        AND fecha_en_proceso IS NOT NULL AND tiempo_preparacion_min > 0
        AND fecha_en_proceso + tiempo_preparacion_min * interval '1 minute' <= now() AT TIME ZONE $1::text
      ORDER BY id_orden_produccion`,
    [ZONA_HORARIA_NEGOCIO],
  );
  if (preparaciones.length) {
    const { completarPreparacionAutomatica } = await import('./ordenesProduccion.service.js');
    for (const preparacion of preparaciones) {
      try {
        await completarPreparacionAutomatica(Number(preparacion.id_orden_produccion));
      } catch (error) {
        console.error(`No se pudo completar automáticamente la preparación ${preparacion.id_orden_produccion}:`, error);
      }
    }
  }
  return ventas.length;
}
