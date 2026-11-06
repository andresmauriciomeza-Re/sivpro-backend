ALTER TABLE tb_productos
  ADD COLUMN stock_mediana INT NOT NULL DEFAULT 0 CHECK (stock_mediana >= 0),
  ADD COLUMN stock_grande INT NOT NULL DEFAULT 0 CHECK (stock_grande >= 0);

ALTER TABLE tb_productos
  DROP CONSTRAINT IF EXISTS ck_productos_precio_grande;

CREATE OR REPLACE FUNCTION marcar_producto_sin_stock_no_disponible()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.estado = 'Disponible'
     AND (
       (
         EXISTS (
           SELECT 1
             FROM tb_categoria_productos c
            WHERE c.id_categoria = NEW.id_categoria
              AND LOWER(TRIM(c.nombre)) = 'pizza'
         )
         AND NEW.stock_mediana + NEW.stock_grande <= 0
       )
       OR (
         NOT EXISTS (
           SELECT 1
             FROM tb_categoria_productos c
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
$$;

ALTER TABLE tb_productos_no_conformes
  ADD COLUMN tamano VARCHAR(20);

COMMENT ON COLUMN tb_productos.precio_venta IS
  'En pizzas, precio por porción de Mediana; en las demás categorías conserva su significado anterior.';
COMMENT ON COLUMN tb_productos.precio_grande IS
  'En pizzas, precio por porción de Grande.';
COMMENT ON COLUMN tb_productos.stock_mediana IS
  'Porciones disponibles de pizzas Medianas. No aplica a otras categorías.';
COMMENT ON COLUMN tb_productos.stock_grande IS
  'Porciones disponibles de pizzas Grandes. No aplica a otras categorías.';
COMMENT ON COLUMN tb_productos_no_conformes.tamano IS
  'Tamaño de la pizza cuyas porciones fueron afectadas; permite devolverlas al stock correcto.';

-- Si una pizza no tenía precio Grande guardado, se usa el recargo vigente antes de convertirlo.
UPDATE tb_productos p
   SET precio_venta = CEIL(p.precio_venta::numeric / 6 / 100) * 100,
       precio_grande = CEIL(COALESCE(p.precio_grande, p.precio_venta + 2000)::numeric / 8 / 100) * 100,
       stock_mediana = p.stock * 6,
       stock = 0
  FROM tb_categoria_productos c
 WHERE c.id_categoria = p.id_categoria
   AND LOWER(TRIM(c.nombre)) = 'pizza';
