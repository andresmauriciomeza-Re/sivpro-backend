BEGIN;

-- Una pizza completa tiene 24 partes: cada mediana consume 3 y cada grande 4.
ALTER TABLE tb_productos
  ADD COLUMN stock_partes INT NOT NULL DEFAULT 0 CHECK (stock_partes >= 0);

-- Conservar el inventario existente de ambas presentaciones.
UPDATE tb_productos p
   SET stock_partes = p.stock_mediana * 3 + p.stock_grande * 4
  FROM tb_categoria_productos c
 WHERE c.id_categoria = p.id_categoria
   AND LOWER(TRIM(c.nombre)) = 'pizza';

CREATE OR REPLACE FUNCTION marcar_producto_sin_stock_no_disponible()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.estado = 'Disponible'
     AND (
       (
         EXISTS (
           SELECT 1 FROM tb_categoria_productos c
            WHERE c.id_categoria = NEW.id_categoria
              AND LOWER(TRIM(c.nombre)) = 'pizza'
         )
         AND NEW.stock_partes < 3
       )
       OR (
         NOT EXISTS (
           SELECT 1 FROM tb_categoria_productos c
            WHERE c.id_categoria = NEW.id_categoria
              AND LOWER(TRIM(c.nombre)) = 'pizza'
         )
         AND NEW.stock <= 0
       )
     )
  THEN
    NEW.estado := 'No disponible';
  END IF;
  RETURN NEW;
END;
$fn$;

COMMENT ON COLUMN tb_productos.stock_partes IS
  'Inventario compartido de pizzas: 24 partes por pizza, 3 por mediana y 4 por grande.';
COMMENT ON COLUMN tb_productos.stock_mediana IS 'obsoleta: usar stock_partes';
COMMENT ON COLUMN tb_productos.stock_grande IS 'obsoleta: usar stock_partes';

COMMIT;
