-- =============================================================================
-- Migración 002 (UP): Motivo de anulación en historial de estados de OC (tb_estadooc)
-- Decisión 2A: columna aditiva `motivo` en tb_estadooc + restricción CHECK NOT VALID
-- SOLO ADITIVA E IDEMPOTENTE (IF NOT EXISTS / NOT VALID).
-- =============================================================================

BEGIN;

-- 1. Columna aditiva para almacenar el motivo cuando una orden pasa a 'Anulado'
ALTER TABLE tb_estadooc
  ADD COLUMN IF NOT EXISTS motivo VARCHAR(500) NULL;

-- 2. Restricción CHECK con NOT VALID: si el estado es 'Anulado', el motivo no puede ser vacío
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_estadooc_motivo_anulacion'
  ) THEN
    ALTER TABLE tb_estadooc
      ADD CONSTRAINT ck_estadooc_motivo_anulacion
      CHECK (
        estado <> 'Anulado'
        OR (motivo IS NOT NULL AND length(btrim(motivo)) > 0)
      ) NOT VALID;
  END IF;
END $$;

COMMIT;
