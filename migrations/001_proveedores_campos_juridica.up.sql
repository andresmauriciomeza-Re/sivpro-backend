-- =============================================================================
-- Migración 001 (UP): Campos adicionales de Persona Jurídica y restricciones
-- Tabla: tb_proveedores
-- Solo aditiva e idempotente (IF NOT EXISTS / bloques DO).
-- No modifica ni borra filas existentes (la fila id_proveedor = 5 no se toca).
-- =============================================================================

BEGIN;

-- 1. Nuevas columnas para Persona Jurídica (NULL para compatibilidad con
--    Persona Natural y con registros existentes).
ALTER TABLE tb_proveedores
  ADD COLUMN IF NOT EXISTS nombre_comercial VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS contacto_telefono_fijo VARCHAR(20) NULL,
  ADD COLUMN IF NOT EXISTS rep_legal_telefono VARCHAR(20) NULL,
  ADD COLUMN IF NOT EXISTS rep_legal_email VARCHAR(100) NULL;

-- 2. Índice único parcial para documento de identidad en Persona Natural.
--    Evita duplicar (tipo_documento, numero_documento) entre proveedores naturales.
CREATE UNIQUE INDEX IF NOT EXISTS idx_proveedores_natural_doc_unico
  ON tb_proveedores (tipo_documento, numero_documento)
  WHERE tipo_persona = 'Natural' AND numero_documento IS NOT NULL;

-- 3. Restricción CHECK de solo dígitos en nit aplicable ÚNICAMENTE a Persona Jurídica.
--    Se crea con NOT VALID para no afectar filas históricas.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_proveedores_nit_juridica_digitos'
  ) THEN
    ALTER TABLE tb_proveedores
      ADD CONSTRAINT ck_proveedores_nit_juridica_digitos
      CHECK (tipo_persona <> 'Juridica' OR nit ~ '^[0-9]{6,15}$') NOT VALID;
  END IF;
END $$;

-- 4. Restricciones CHECK de formato para los nuevos teléfonos (solo dígitos cuando no son NULL).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_proveedores_contacto_tel_fijo'
  ) THEN
    ALTER TABLE tb_proveedores
      ADD CONSTRAINT ck_proveedores_contacto_tel_fijo
      CHECK (contacto_telefono_fijo IS NULL OR contacto_telefono_fijo ~ '^[0-9]{7,20}$') NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_proveedores_rep_legal_telefono'
  ) THEN
    ALTER TABLE tb_proveedores
      ADD CONSTRAINT ck_proveedores_rep_legal_telefono
      CHECK (rep_legal_telefono IS NULL OR rep_legal_telefono ~ '^[0-9]{7,20}$') NOT VALID;
  END IF;
END $$;

COMMIT;
