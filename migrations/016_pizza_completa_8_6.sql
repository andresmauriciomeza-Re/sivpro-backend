BEGIN;

-- Convierte el stock de pizzas de la regla anterior (6/8) a la nueva (8/6).
UPDATE tb_productos p
   SET stock_mediana = FLOOR(p.stock_mediana::numeric * 8 / 6),
       stock_grande = FLOOR(p.stock_grande::numeric * 6 / 8)
  FROM tb_categoria_productos c
 WHERE c.id_categoria = p.id_categoria
   AND LOWER(TRIM(c.nombre)) = 'pizza';

COMMIT;
