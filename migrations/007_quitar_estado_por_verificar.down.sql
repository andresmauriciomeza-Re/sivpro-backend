-- Agrega el estado Por verificar al flujo de órdenes de producción.
-- Por verificar requiere fecha_en_proceso, igual que En proceso y Completada.
BEGIN;

ALTER TABLE tb_orden_produccion
  DROP CONSTRAINT IF EXISTS ck_op_estado;

ALTER TABLE tb_orden_produccion
  ADD CONSTRAINT ck_op_estado
  CHECK (estado IN ('Pendiente', 'En proceso', 'Por verificar', 'Completada', 'Cancelada'));

ALTER TABLE tb_orden_produccion
  DROP CONSTRAINT IF EXISTS ck_op_fechas;

ALTER TABLE tb_orden_produccion
  ADD CONSTRAINT ck_op_fechas
  CHECK (
    (estado NOT IN ('En proceso', 'Por verificar', 'Completada') OR fecha_en_proceso IS NOT NULL)
    AND (estado <> 'Completada' OR fecha_completada IS NOT NULL)
    AND (estado <> 'Cancelada' OR fecha_cancelada IS NOT NULL)
  );

COMMIT;
