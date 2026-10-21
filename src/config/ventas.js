export const ZONA_HORARIA_NEGOCIO = 'America/Bogota';
export const RECARGO_PIZZA_GRANDE = 2000;

/** Ventana en la que la venta todavía se puede anular (panel o cliente),
    contada DESDE tb_venta.fecha y validada siempre en el backend. */
export const MINUTOS_ANULACION = 10;
export const SEGUNDOS_ANULACION = MINUTOS_ANULACION * 60;

/** Pedidos tomados en el local (panel): el formulario no pide hora de
    recogida, así que el backend auto-asigna "ahora + estos minutos", que es
    lo que demora la preparación de la pizza. */
export const MINUTOS_PREPARACION_PANEL = 25;

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
  // Anulación desde el listado del panel: solo dentro de los primeros 10
  // minutos (esa regla de tiempo no vive aquí, se valida en la transacción).
  ['Por entregar', 'Anulado'],
  ['Por entregar', 'Completado'],
  ['Completado', 'Devolucion'],
]);

export const puedeTransicionarVenta = (desde, hacia) =>
  TRANSICIONES_VENTA.some(([origen, destino]) => origen === desde && destino === hacia);
