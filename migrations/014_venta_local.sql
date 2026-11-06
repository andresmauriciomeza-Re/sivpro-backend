BEGIN;

ALTER TABLE tb_venta
  ADD COLUMN venta_local BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN tb_venta.venta_local IS
  'Indica que la venta fue registrada desde el panel en el local.';

COMMIT;
