-- Un producto sin stock no puede quedar marcado como disponible.
BEGIN;

CREATE OR REPLACE FUNCTION marcar_producto_sin_stock_no_disponible()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.stock <= 0 AND NEW.estado = 'Disponible' THEN
    NEW.estado := 'No disponible';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_producto_sin_stock_no_disponible ON tb_productos;
CREATE TRIGGER trg_producto_sin_stock_no_disponible
  BEFORE INSERT OR UPDATE ON tb_productos
  FOR EACH ROW
  EXECUTE FUNCTION marcar_producto_sin_stock_no_disponible();

UPDATE tb_productos
   SET estado = 'No disponible'
 WHERE stock <= 0
   AND estado = 'Disponible';

COMMIT;
