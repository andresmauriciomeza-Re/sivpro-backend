-- Peso de medida del insumo: cantidad exacta de una unidad del insumo
-- (ej. "1200 g", "5 lt"). Obligatorio al crear desde el formulario de insumos;
-- los insumos antiguos quedan en NULL hasta que se editen.
-- Idempotente: puede ejecutarse más de una vez sin perder datos nuevos.
BEGIN;

ALTER TABLE tb_insumo
  ADD COLUMN IF NOT EXISTS peso_medida NUMERIC(10, 2);

ALTER TABLE tb_insumo
  DROP CONSTRAINT IF EXISTS ck_insumo_peso_medida;
ALTER TABLE tb_insumo
  ADD CONSTRAINT ck_insumo_peso_medida
  CHECK (peso_medida IS NULL OR peso_medida > 0);

COMMENT ON COLUMN tb_insumo.peso_medida IS
  'Peso/cantidad exacta del insumo en su unidad de medida (ej. 1200 g). NULL en insumos antiguos.';

COMMIT;
