BEGIN;

ALTER TABLE tb_parametros_costos
  DROP COLUMN IF EXISTS auxilio_transporte;

COMMIT;
