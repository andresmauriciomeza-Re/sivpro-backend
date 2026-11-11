-- Revierte la migración 018 (IVA por ítem y presentaciones de compra).
-- Conserva todas las columnas originales; solo elimina lo que agregó 018.
BEGIN;

-- iva_incluido vuelve a ser obligatorio: las compras mixtas (NULL) se
-- resuelven en false si alguna línea no era 'incluido' y en true en el resto.
UPDATE tb_compras c
   SET iva_incluido = NOT EXISTS (
         SELECT 1
           FROM tb_detallecompra d
          WHERE d.id_compra = c.id_compra
            AND d.modo_iva <> 'incluido'
       )
 WHERE c.iva_incluido IS NULL;

ALTER TABLE tb_compras
  ALTER COLUMN iva_incluido SET NOT NULL;

DROP TABLE IF EXISTS tb_insumo_presentacion;

-- Las columnas agregadas por 018 se eliminan con sus CHECK asociados.
ALTER TABLE tb_detallecompra DROP CONSTRAINT IF EXISTS ck_dcompra_modo_iva;
ALTER TABLE tb_detallecompra DROP CONSTRAINT IF EXISTS ck_dcompra_unidades_base;
ALTER TABLE tb_detallecompra DROP COLUMN IF EXISTS modo_iva;
ALTER TABLE tb_detallecompra DROP COLUMN IF EXISTS unidades_base;
ALTER TABLE tb_detallecompra DROP COLUMN IF EXISTS unidad_base;

ALTER TABLE tb_detalleordencompra DROP CONSTRAINT IF EXISTS ck_dorcompra_modo_iva;
ALTER TABLE tb_detalleordencompra DROP CONSTRAINT IF EXISTS ck_dorcompra_unidades_base;
ALTER TABLE tb_detalleordencompra DROP COLUMN IF EXISTS modo_iva;
ALTER TABLE tb_detalleordencompra DROP COLUMN IF EXISTS unidades_base;
ALTER TABLE tb_detalleordencompra DROP COLUMN IF EXISTS unidad_base;

COMMIT;
