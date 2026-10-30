-- Revierte la regla automática. Los productos ya corregidos se mantienen como
-- No disponible para evitar reactivar productos que siguen sin stock.
BEGIN;

DROP TRIGGER IF EXISTS trg_producto_sin_stock_no_disponible ON tb_productos;
DROP FUNCTION IF EXISTS marcar_producto_sin_stock_no_disponible();

COMMIT;
