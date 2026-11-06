import { query } from '../config/db.js';
import { MINUTOS_CALENTAMIENTO_PEDIDO } from '../config/produccion.js';
import { ESTADOS_VENTA, MINUTOS_COMPLETAR_VENTA_LOCAL, ZONA_HORARIA_NEGOCIO } from '../config/ventas.js';
import { notificarEstadoPedido } from './pedidoEmail.service.js';

export async function avanzarAutomaticamente() {
  const { rows: ordenes } = await query(
    `WITH completadas AS (
       UPDATE tb_orden_produccion
          SET estado = 'Completada',
              fecha_completada = now() AT TIME ZONE $1::text,
              historial = COALESCE(historial::jsonb, '[]'::jsonb) || jsonb_build_array(
                jsonb_build_object('de', 'En proceso', 'a', 'Completada',
                  'fechaHora', to_char(now() AT TIME ZONE $1::text, 'YYYY-MM-DD"T"HH24:MI:SS'),
                  'automatico', TRUE))
        WHERE tipo = 'Pedido' AND estado = 'En proceso'
          AND fecha_en_proceso + interval '${MINUTOS_CALENTAMIENTO_PEDIDO} minutes' <= now() AT TIME ZONE $1::text
        RETURNING id_orden_produccion, id_venta
     ), detalles AS (
       UPDATE tb_detalle_orden_produccion d
          SET cantidad_real = d.cantidad_estimada
         FROM completadas op
        WHERE d.id_orden_produccion = op.id_orden_produccion
       RETURNING d.id_detalle_op
     )
     SELECT id_orden_produccion, id_venta FROM completadas`,
    [ZONA_HORARIA_NEGOCIO],
  );
  const { rows: ventas, rowCount } = await query(
    `UPDATE tb_venta
        SET estado = $1::text, fecha_estado = now() AT TIME ZONE $2::text
      WHERE estado = $3::text
        AND (
          (venta_local = TRUE AND (
            fecha_estado + interval '${MINUTOS_COMPLETAR_VENTA_LOCAL} minutes' <= now() AT TIME ZONE $2::text
            OR EXISTS (
              SELECT 1 FROM tb_orden_produccion op
               WHERE op.id_venta = tb_venta.id_venta
                 AND op.tipo = 'Pedido' AND op.estado = 'Completada'
            )
          ))
          OR (
            venta_local = FALSE
            AND hora_recogida IS NOT NULL
            AND (fecha::date + hora_recogida + CASE WHEN hora_recogida < fecha::time THEN interval '1 day' ELSE interval '0' END) <= now() AT TIME ZONE $2::text
            AND (
              NOT EXISTS (
                SELECT 1 FROM tb_orden_produccion op
                 WHERE op.id_venta = tb_venta.id_venta AND op.tipo = 'Pedido'
              )
              OR EXISTS (
                SELECT 1 FROM tb_orden_produccion op
                 WHERE op.id_venta = tb_venta.id_venta
                   AND op.tipo = 'Pedido' AND op.estado = 'Completada'
              )
            )
          )
        )
      RETURNING id_venta`,
    [ESTADOS_VENTA.COMPLETADO, ZONA_HORARIA_NEGOCIO, ESTADOS_VENTA.POR_ENTREGAR],
  );
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
  const ids = new Set([...ordenes, ...ventas].map((fila) => fila.id_venta).filter((id) => id != null));
  for (const id of ids) void notificarEstadoPedido(id);
  return rowCount;
}
