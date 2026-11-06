BEGIN;

UPDATE tb_venta
   SET venta_local = TRUE
 WHERE id_venta IN (
   SELECT id_venta
     FROM tb_orden_produccion
    WHERE venta_local = 'true'
 );

UPDATE tb_orden_produccion
   SET venta_local = NULL
 WHERE venta_local IN ('true', 'false');

COMMIT;
