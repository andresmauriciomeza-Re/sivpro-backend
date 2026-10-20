export const ZONA_HORARIA_NEGOCIO = 'America/Bogota';
export const RECARGO_PIZZA_GRANDE = 2000;

export const ESTADOS_VENTA = Object.freeze({
  POR_VERIFICAR: 'Por verificar',
  EN_ESPERA: 'En espera',
  POR_ENTREGAR: 'Por entregar',
  COMPLETADO: 'Completado',
  DEVOLUCION: 'Devolucion',
  ANULADO: 'Anulado',
});

export const TRANSICIONES_VENTA = Object.freeze([
  ['Por verificar', 'En espera'],
  ['Por verificar', 'Por entregar'],
  ['Por verificar', 'Anulado'],
  ['En espera', 'Por verificar'],
  ['En espera', 'Anulado'],
  ['Por entregar', 'Completado'],
  ['Completado', 'Devolucion'],
]);

export const puedeTransicionarVenta = (desde, hacia) =>
  TRANSICIONES_VENTA.some(([origen, destino]) => origen === desde && destino === hacia);
