import AppError from '../errors/AppError.js';

function convertirFechaHoraLocalAepoch(valor) {
  if (typeof valor !== 'string') return NaN;
  const normalizado = valor.replace(' ', 'T');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(normalizado)) return NaN;
  const epoch = Date.parse(`${normalizado}Z`);
  return Number.isFinite(epoch) ? epoch : NaN;
}

export function validarFechaLimitePedido({ fechaLimite, ahoraBogota, recogidaBogota }) {
  const limiteEpoch = convertirFechaHoraLocalAepoch(fechaLimite);
  const ahoraEpoch = convertirFechaHoraLocalAepoch(ahoraBogota);
  const recogidaEpoch = recogidaBogota == null ? null : convertirFechaHoraLocalAepoch(recogidaBogota);

  if (!Number.isFinite(limiteEpoch) || !Number.isFinite(ahoraEpoch)) {
    throw new AppError('No se pudo validar la fecha límite del Pedido.', 500);
  }
  if (recogidaBogota != null && !Number.isFinite(recogidaEpoch)) {
    throw new AppError('No se pudo validar la hora de recogida del Pedido.', 500);
  }
  if (limiteEpoch < ahoraEpoch + 60_000) {
    throw new AppError('La fecha límite debe ser al menos un minuto posterior a la hora actual de Bogotá.', 400);
  }

  const recogidaFutura = recogidaEpoch != null && recogidaEpoch > ahoraEpoch;
  if (recogidaFutura && limiteEpoch > recogidaEpoch) {
    throw new AppError('La fecha límite de un Pedido no puede ser posterior a su hora de recogida.', 400);
  }
  return { recogidaFutura };
}
