BEGIN;

ALTER TABLE tb_parametros_costos
  ADD COLUMN IF NOT EXISTS mano_obra_hora NUMERIC(12, 2) NOT NULL DEFAULT 12673
    CHECK (mano_obra_hora >= 0);

ALTER TABLE tb_parametros_costos
  DROP COLUMN IF EXISTS salario_base,
  DROP COLUMN IF EXISTS factor_prestacional,
  DROP COLUMN IF EXISTS jornada_semanal,
  DROP COLUMN IF EXISTS personas_preparacion;

COMMIT;
