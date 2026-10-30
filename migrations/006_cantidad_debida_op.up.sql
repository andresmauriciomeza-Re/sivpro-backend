BEGIN;

ALTER TABLE tb_detalle_orden_produccion
  ADD COLUMN IF NOT EXISTS cantidad_debida NUMERIC;

ALTER TABLE tb_detalle_orden_produccion
  ADD COLUMN IF NOT EXISTS insumos_consumidos JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMIT;
