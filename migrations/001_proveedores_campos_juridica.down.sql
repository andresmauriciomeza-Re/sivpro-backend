-- =============================================================================
-- Migración 001 (DOWN - Deshacer): Revierte los cambios de la migración 001
-- Tabla: tb_proveedores
-- =============================================================================

BEGIN;

ALTER TABLE tb_proveedores
  DROP CONSTRAINT IF EXISTS ck_proveedores_rep_legal_telefono,
  DROP CONSTRAINT IF EXISTS ck_proveedores_contacto_tel_fijo,
  DROP CONSTRAINT IF EXISTS ck_proveedores_nit_juridica_digitos;

DROP INDEX IF EXISTS idx_proveedores_natural_doc_unico;

ALTER TABLE tb_proveedores
  DROP COLUMN IF EXISTS rep_legal_email,
  DROP COLUMN IF EXISTS rep_legal_telefono,
  DROP COLUMN IF EXISTS contacto_telefono_fijo,
  DROP COLUMN IF EXISTS nombre_comercial;

COMMIT;
