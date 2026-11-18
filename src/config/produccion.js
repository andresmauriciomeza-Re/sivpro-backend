export const PORCIONES_TAMANO = Object.freeze({
  pizza: Object.freeze({ Mediana: 8, Grande: 6 }),
  lasana: Object.freeze({ Normal: 1 }),
});

export const UNIDADES_ESCALABLES = new Set(['kg', 'g', 'lt', 'ml']);

export const MINUTOS_CALENTAMIENTO_PEDIDO = 25;
export const MINIMO_PREPARACION_PEDIDO = 5;
export const MAXIMO_PREPARACION_PEDIDO = 180;

export function minutosValidosPedido(valor) {
  return Number.isInteger(valor) && valor >= MINIMO_PREPARACION_PEDIDO && valor <= MAXIMO_PREPARACION_PEDIDO;
}

export const minutosPedidoSql = (alias) =>
  `CASE WHEN ${alias}.tiempo_preparacion_min BETWEEN ${MINIMO_PREPARACION_PEDIDO} AND ${MAXIMO_PREPARACION_PEDIDO}
        THEN ${alias}.tiempo_preparacion_min ELSE ${MINUTOS_CALENTAMIENTO_PEDIDO} END`;

export const finPedidoSql = (alias) =>
  `(${alias}.fecha_en_proceso + (${minutosPedidoSql(alias)}) * interval '1 minute')`;

// El ?ltimo ajuste del tiempo determina si el pedido requiere cierre manual.
export const cierreManualPedidoSql = (alias) =>
  `COALESCE(
    jsonb_path_query_array(${alias}.historial::jsonb, '$[*] ? (exists (@.cierre_manual_por_tiempo))')
      -> -1 -> 'cierre_manual_por_tiempo' = 'true'::jsonb,
    FALSE
  )`;
