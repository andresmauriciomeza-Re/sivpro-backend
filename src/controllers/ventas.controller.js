import AppError from '../errors/AppError.js';
import {
  crearVentaCliente,
  crearVentaPanel,
  entregarVenta,
  listarVentas,
  subirComprobanteCliente,
  verificarVenta,
} from '../services/ventas.service.js';
import {
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

export async function entregarVentaController(req, res, next) {
  try {
    const resultado = await entregarVenta(idNumerico(req.params.id));
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
