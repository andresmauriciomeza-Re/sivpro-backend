-- Revierte Por verificar a En proceso antes de restaurar las restricciones.
BEGIN;

UPDATE tb_orden_produccion
   SET estado = 'En proceso'
 WHERE estado = 'Por verificar';

ALTER TABLE tb_orden_produccion
  DROP CONSTRAINT IF EXISTS ck_op_estado;

ALTER TABLE tb_orden_produccion
  ADD CONSTRAINT ck_op_estado
  CHECK (estado IN ('Pendiente', 'En proceso', 'Completada', 'Cancelada'));

ALTER TABLE tb_orden_produccion
  DROP CONSTRAINT IF EXISTS ck_op_fechas;

ALTER TABLE tb_orden_produccion
  ADD CONSTRAINT ck_op_fechas
  CHECK (
    (estado NOT IN ('En proceso', 'Completada') OR fecha_en_proceso IS NOT NULL)
    AND (estado <> 'Completada' OR fecha_completada IS NOT NULL)
    AND (estado <> 'Cancelada' OR fecha_cancelada IS NOT NULL)
  );

COMMIT;
