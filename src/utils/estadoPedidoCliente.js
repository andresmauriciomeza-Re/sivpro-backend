export const PASOS_PEDIDO = [
  'Pendiente',
  'Aceptado',
  'En proceso',
  'Por entregar',
  'Completado',
];

const MOTIVOS_RECHAZO = new Set([
  'Comprobante falso',
  'La imagen no corresponde a un comprobante',
  'Comprobante borroso',
]);

const esMotivoRechazo = (motivo) =>
  MOTIVOS_RECHAZO.has(motivo)
  || (typeof motivo === 'string' && /^Otro:\s+\S/.test(motivo));

export function estadoClientePedido({
  estadoVenta,
  estadoOrden,
  tieneOrden,
  anulado_por,
  motivo_rechazo,
}) {
  if (estadoVenta === 'Por verificar') return 'Pendiente';
  if (estadoVenta === 'En espera') return 'En espera';
  if (estadoVenta === 'Por entregar') {
    if (!tieneOrden) return 'Por entregar';
    if (estadoOrden === 'En proceso') return 'En proceso';
    if (estadoOrden === 'Completada') return 'Por entregar';
    if (estadoOrden === 'Pendiente' || estadoOrden === 'Cancelada') return 'Aceptado';
    return 'Aceptado';
  }
  if (estadoVenta === 'Completado') return 'Completado';
  if (estadoVenta === 'Anulado') {
    return anulado_por === 'Administrador' && esMotivoRechazo(motivo_rechazo)
      ? 'Rechazado'
      : 'Anulado';
  }
  if (estadoVenta === 'Devolucion') return 'Devolución';
  return estadoVenta;
}
