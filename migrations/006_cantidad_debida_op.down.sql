BEGIN;

ALTER TABLE tb_detalle_orden_produccion
  DROP COLUMN IF EXISTS cantidad_debida,
  DROP COLUMN IF EXISTS insumos_consumidos;

COMMIT;
