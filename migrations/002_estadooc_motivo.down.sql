-- =============================================================================
-- Migración 002 (DOWN): Revertir columna `motivo` y restricción en tb_estadooc
-- =============================================================================

BEGIN;

ALTER TABLE tb_estadooc
  DROP CONSTRAINT IF EXISTS ck_estadooc_motivo_anulacion;

ALTER TABLE tb_estadooc
  DROP COLUMN IF EXISTS motivo;

COMMIT;
