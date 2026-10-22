import AppError from '../errors/AppError.js';
import {
  anularVenta,
  cancelarVentaCliente,
  crearVentaCliente,
  crearVentaPanel,
  listarVentas,
  marcarDevolucion,
  resolverDevolucion,
  subirComprobanteCliente,
  verificarVenta,
} from '../services/ventas.service.js';
import {
  validarAnulacion,
  validarClientePanel,
  validarComprobante,
  validarCrearVenta,
  validarVerificacion,
} from '../validators/ventas.validator.js';

function idNumerico(valor) {
  const id = Number(valor);
  if (!Number.isSafeInteger(id) || id <= 0) throw new AppError('El id de venta no es válido.', 400);
  return id;
}

export async function crearVentaClienteController(req, res, next) {
  try {
    const entrada = validarCrearVenta(req.body);
    const venta = await crearVentaCliente(req.usuario.id, entrada);
    res.status(201).json(venta);
  } catch (error) { next(error); }
}

export async function crearVentaPanelController(req, res, next) {
  try {
    const cliente = validarClientePanel(req.body);
    const entrada = validarCrearVenta(req.body, { panel: true });
    const venta = await crearVentaPanel(cliente, entrada);
    res.status(201).json(venta);
  } catch (error) { next(error); }
}

export async function listarMisVentasController(req, res, next) {
  try {
    res.json(await listarVentas({ idUsuario: req.usuario.id }));
  } catch (error) { next(error); }
}

export async function listarVentasController(req, res, next) {
  try {
    res.json(await listarVentas());
  } catch (error) { next(error); }
}

export async function obtenerVentaController(req, res, next) {
  try {
    const ventas = await listarVentas({ idVenta: idNumerico(req.params.id) });
    if (!ventas[0]) throw new AppError('Venta no encontrada.', 404);
    res.json(ventas[0]);
  } catch (error) { next(error); }
}

export async function verificarVentaController(req, res, next) {
  try {
    const resultado = await verificarVenta(idNumerico(req.params.id), validarVerificacion(req.body));
    res.json(resultado);
  } catch (error) { next(error); }
}

export async function anularVentaController(req, res, next) {
  try {
    const resultado = await anularVenta(idNumerico(req.params.id), validarAnulacion(req.body));
    res.json(resultado);
  } catch (error) { next(error); }
}

/** Cancelación del propio cliente (sólo verificarToken, sin permiso de panel):
    la venta debe pertenecerle y estar dentro de los primeros 10 minutos. */
export async function cancelarVentaClienteController(req, res, next) {
  try {
    const resultado = await cancelarVentaCliente(idNumerico(req.params.id), req.usuario.id);
    res.json(resultado);
  } catch (error) { next(error); }
}

/** Marca una venta como devolución (Completado → Devolucion) y abre la fila
    pendiente en tb_devolucion. El detalle y la venta de canje se registran al
    confirmar, en el resolver. */
export async function marcarDevolucionController(req, res, next) {
  try {
    const resultado = await marcarDevolucion(idNumerico(req.params.id));
    res.json(resultado);
  } catch (error) { next(error); }
}

/** Resuelve la devolución: registra lo devuelto por línea y, si hay canje,
    crea la nueva venta del cliente + su orden de producción. El cuerpo se
    valida dentro del servicio (necesita la estructura ya parseada). */
export async function resolverDevolucionController(req, res, next) {
  try {
    const resultado = await resolverDevolucion(idNumerico(req.params.id), req.body);
    res.json(resultado);
  } catch (error) { next(error); }
}

export async function subirComprobanteController(req, res, next) {
  try {
    const resultado = await subirComprobanteCliente(
      req.usuario.id,
      idNumerico(req.params.id),
      validarComprobante(req.body)
    );
    res.status(201).json(resultado);
  } catch (error) { next(error); }
}
