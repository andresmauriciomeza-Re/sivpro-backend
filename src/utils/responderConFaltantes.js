/**
 * Responde un AppError que trae `faltantes` (insumos o productos con stock
 * insuficiente) incluyéndolos en el body. El manejador de errores global sólo
 * serializa message + statusCode, así que los controladores que pueden
 * producir esta respuesta lo usan en su `catch`.
 *
 * Mismo formato en todos los casos:
 *   { error: { message, statusCode, faltantes: [{ id_insumo, id_producto, nombre,
 *              requerido, stock, falta, unidad, motivo }] } }
 */
export default function responderConFaltantes(error, res, next) {
  if (!error.faltantes) return next(error);
  return res.status(error.statusCode).json({
    error: { message: error.message, statusCode: error.statusCode, faltantes: error.faltantes },
  });
}
