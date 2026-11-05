-- Propuesta basada en los JOIN, filtros y ORDER BY de los listados del panel.
-- Confirmar primero si ya existen índices equivalentes en la rama production.

CREATE INDEX IF NOT EXISTS idx_productos_categoria_listado
  ON tb_productos (id_categoria, id_producto);

CREATE INDEX IF NOT EXISTS idx_ficha_tecnica_producto_vigente_version
  ON tb_ficha_tecnica (id_producto, version DESC)
  WHERE fecha_final IS NULL;

CREATE INDEX IF NOT EXISTS idx_ficha_tecnica_insumo_vigente_version
  ON tb_ficha_tecnica (id_insumo, version DESC)
  WHERE fecha_final IS NULL;

CREATE INDEX IF NOT EXISTS idx_insumo_ficha_tecnica_ficha_insumo
  ON tb_insumo_ficha_tecnica (id_ft, id_insumo);

CREATE INDEX IF NOT EXISTS idx_orden_produccion_fecha_listado
  ON tb_orden_produccion (fecha_creacion DESC, id_orden_produccion DESC);

CREATE INDEX IF NOT EXISTS idx_orden_produccion_venta_pedido
  ON tb_orden_produccion (id_venta, id_orden_produccion DESC)
  WHERE tipo = 'Pedido';

CREATE INDEX IF NOT EXISTS idx_detalle_orden_produccion_orden_detalle
  ON tb_detalle_orden_produccion (id_orden_produccion, id_detalle_op);

CREATE INDEX IF NOT EXISTS idx_venta_fecha_listado
  ON tb_venta (fecha DESC, id_venta DESC);

CREATE INDEX IF NOT EXISTS idx_venta_cliente_no_anulada
  ON tb_venta (id_cliente)
  WHERE estado <> 'Anulado';

CREATE INDEX IF NOT EXISTS idx_detalle_venta_venta_detalle
  ON tb_detalle_venta (id_venta, id_detalle_venta);

CREATE INDEX IF NOT EXISTS idx_pagos_venta_pago
  ON tb_pagos (id_venta, id_pago);

CREATE INDEX IF NOT EXISTS idx_devolucion_venta
  ON tb_devolucion (id_venta);

CREATE INDEX IF NOT EXISTS idx_detalle_devolucion_devolucion_detalle
  ON tb_detalle_devolucion (id_devolucion, id_detalle_dev);

CREATE INDEX IF NOT EXISTS idx_compras_fecha_listado
  ON tb_compras (fecha DESC, id_compra DESC);

CREATE INDEX IF NOT EXISTS idx_detallecompra_compra_detalle
  ON tb_detallecompra (id_compra, id_dcompra);

CREATE INDEX IF NOT EXISTS idx_ordencompras_fecha_listado
  ON tb_ordencompras (fecha DESC, id_ocompra DESC);

CREATE INDEX IF NOT EXISTS idx_estadooc_orden_fecha_estado
  ON tb_estadooc (id_ocompra, fecha_estado, id_estadooc);

CREATE INDEX IF NOT EXISTS idx_detalleordencompra_orden_detalle
  ON tb_detalleordencompra (id_ocompra, id_dorcompra);

CREATE INDEX IF NOT EXISTS idx_recepcion_orden_orden
  ON tb_recepcion_orden (id_ocompra);

CREATE INDEX IF NOT EXISTS idx_productos_no_conformes_fecha_listado
  ON tb_productos_no_conformes (fecha_registro DESC, id_producto_no_conforme DESC);

CREATE INDEX IF NOT EXISTS idx_cliente_usuario
  ON tb_cliente (id_usuario);

CREATE INDEX IF NOT EXISTS idx_empleado_usuario
  ON tb_empleado (id_usuario);

CREATE INDEX IF NOT EXISTS idx_contratacion_empleado_fecha
  ON tb_contratacion_empleado (id_empleado, fecha_inicio DESC, id_contrato DESC);

CREATE INDEX IF NOT EXISTS idx_empleado_roles_contrato
  ON tb_empleado_roles (id_contrato, id_rol);

CREATE INDEX IF NOT EXISTS idx_proveedores_nombre
  ON tb_proveedores (nombre);

CREATE INDEX IF NOT EXISTS idx_usuarios_nombre_id
  ON tb_usuarios (nombre, id_usuario);
