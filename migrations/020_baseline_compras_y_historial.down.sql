-- =============================================================================
-- Migración 020 (DOWN): quita solo lo creado como restricción/índice por la 020.
-- NO borra columnas ni filas (incluidas las de tb_estadooc insertadas en el backfill).
-- =============================================================================

BEGIN;

ALTER TABLE tb_compras
  DROP CONSTRAINT IF EXISTS ck_compras_motivo_anulacion;

DROP INDEX IF EXISTS idx_detallecompra_es_no_solicitado;

COMMIT;
