// Definición ÚNICA de "contratación vigente" de un empleado. Todas las consultas
// que antes usaban `fecha_final IS NULL` arman su condición con estos fragmentos.
//
// "Hoy" se calcula en hora de Bogotá (no en UTC), para que a las 8 p. m. hora
// local una contratación no cambie de día antes de tiempo. Las fechas viajan
// como 'YYYY-MM-DD' (to_char) para que ningún cliente las corra por zona horaria.

export const HOY_BOGOTA = "(now() AT TIME ZONE 'America/Bogota')::date";

/** Vigente: ya empezó y todavía no terminó (fecha final vacía o de hoy en adelante). */
export const contratoVigenteSql = (alias) =>
  `(${alias}.fecha_inicio <= ${HOY_BOGOTA} AND (${alias}.fecha_final IS NULL OR ${alias}.fecha_final >= ${HOY_BOGOTA}))`;

/** Abierta: vigente o todavía por empezar. Es la única que se puede editar; las
 *  cerradas (fecha final anterior a hoy) son historial. */
export const contratoAbiertoSql = (alias) =>
  `(${alias}.fecha_final IS NULL OR ${alias}.fecha_final >= ${HOY_BOGOTA})`;
