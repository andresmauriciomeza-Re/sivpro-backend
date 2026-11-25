-- =============================================================================
-- Migración 020 (UP): Baseline de compras (anulación, IVA por línea, no solicitados)
-- e historial de órdenes de compra.
-- Deja en migraciones de Postgres lo que ya existe en la base (columnas creadas
-- fuera de migrations/), para poder reconstruir el esquema en un ambiente nuevo.
-- IDEMPOTENTE: IF NOT EXISTS / bloques DO. No modifica ni borra datos existentes.
-- No toca el formato del NIT ni ck_proveedores_nit_juridica_digitos;
-- tb_proveedores_nit_key (UNIQUE nit) ya existe, por eso no se crea índice de NIT.
-- =============================================================================

BEGIN;

-- 1. Columnas de tb_compras (tipos idénticos a los actuales en la base)
ALTER TABLE tb_compras
  ADD COLUMN IF NOT EXISTS motivo_anulacion VARCHAR(500) NULL,
  ADD COLUMN IF NOT EXISTS fecha_anulacion TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS iva_incluido BOOLEAN NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS subtotal_sin_iva NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_iva NUMERIC(12,2) NOT NULL DEFAULT 0;

-- 2. Columnas de tb_detallecompra.
--    base_sin_iva / monto_iva son NOT NULL sin default (como hoy). En una tabla con
--    filas, un ADD COLUMN NOT NULL sin default falla; en la base actual ya existen,
--    por lo que esta sentencia es un no-op.
ALTER TABLE tb_detallecompra
  ADD COLUMN IF NOT EXISTS base_sin_iva NUMERIC(12,2) NOT NULL,
  ADD COLUMN IF NOT EXISTS monto_iva NUMERIC(12,2) NOT NULL,
  ADD COLUMN IF NOT EXISTS es_no_solicitado BOOLEAN NOT NULL DEFAULT FALSE;

-- 3. CHECK: una compra anulada debe tener motivo. Se crea NOT VALID y, si no hay
--    filas en conflicto, se valida (solo si aún no está validado).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_compras_motivo_anulacion'
  ) THEN
    ALTER TABLE tb_compras
      ADD CONSTRAINT ck_compras_motivo_anulacion
      CHECK (
        estado <> 'Anulado'
        OR (motivo_anulacion IS NOT NULL AND length(btrim(motivo_anulacion)) > 0)
      ) NOT VALID;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ck_compras_motivo_anulacion'
       AND conrelid = 'tb_compras'::regclass
       AND convalidated = FALSE
  ) THEN
    ALTER TABLE tb_compras VALIDATE CONSTRAINT ck_compras_motivo_anulacion;
  END IF;
END $$;

-- 4. Historial de órdenes de compra: toda orden debe tener al menos un estado.
--    Las órdenes sin historial reciben 'Borrador' (estado inicial de crearOrdenCompra)
--    con la fecha de creación de la orden.
INSERT INTO tb_estadooc (id_ocompra, estado, fecha_estado)
SELECT o.id_ocompra, 'Borrador', o.fecha
  FROM tb_ordencompras o
 WHERE NOT EXISTS (
   SELECT 1 FROM tb_estadooc e WHERE e.id_ocompra = o.id_ocompra
 );

-- 5. Índice para filtrar compras con insumos no solicitados.
CREATE INDEX IF NOT EXISTS idx_detallecompra_es_no_solicitado
  ON tb_detallecompra (es_no_solicitado);

COMMIT;
