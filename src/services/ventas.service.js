import AppError from '../errors/AppError.js';

const normalizarNombre = (valor) => {
  const excepciones = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e']);
  return String(valor ?? '').trim().toLocaleLowerCase('es').split(/\s+/).filter(Boolean)
    .map((palabra, indice) => indice > 0 && excepciones.has(palabra) ? palabra : palabra.charAt(0).toLocaleUpperCase('es') + palabra.slice(1)).join(' ');
};
import { query, transaction } from '../config/db.js';
import { RECARGO_PIZZA_GRANDE, ZONA_HORARIA_NEGOCIO, ESTADOS_VENTA, puedeTransicionarVenta } from '../config/ventas.js';
import { enviarAvisoMontoFaltante } from './mail.service.js';
import { crearOrdenProduccion } from './ordenProduccion.service.js';

const MOTIVOS_RECHAZO = ['Comprobante falso', 'Dinero faltante'];

function fechaHoraBogota(fecha = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_HORARIA_NEGOCIO,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(fecha);
  const valor = Object.fromEntries(partes.map((parte) => [parte.type, parte.value]));
  return {
    fecha: `${valor.year}-${valor.month}-${valor.day}`,
    timestamp: `${valor.year}-${valor.month}-${valor.day} ${valor.hour}:${valor.minute}:${valor.second}`,
    minutos: Number(valor.hour) * 60 + Number(valor.minute),
  };
}

function normalizarCategoria(nombre) {
  return String(nombre || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

function validarFechaRecogida(hora) {
  const actual = fechaHoraBogota();
  const [horas, minutos] = hora.split(':').map(Number);
  const minutosRecogida = horas * 60 + minutos;
  if (horas < 12 || minutosRecogida <= actual.minutos) {
    throw new AppError('La hora de recogida debe ser posterior a la hora actual de Colombia y en horario PM.', 400);
  }
  return actual;
}

function precioYTamano(producto, tamano) {
  const categoria = normalizarCategoria(producto.categoria_nombre);
  const tipo = producto.tipo;
  if (tipo === 'Elaborado' && categoria === 'pizza') {
    if (!['Mediana', 'Grande'].includes(tamano)) throw new AppError(`Selecciona Mediana o Grande para ${producto.nombre}.`, 400);
    return Number(producto.precio_venta) + (tamano === 'Grande' ? RECARGO_PIZZA_GRANDE : 0);
  }
  if (tipo === 'Elaborado' && categoria === 'lasana') {
    if (tamano !== 'Normal') throw new AppError(`El tamaño de ${producto.nombre} debe ser Normal.`, 400);
    return Number(producto.precio_venta);
  }
  if (tipo === 'Reventa' && categoria === 'bebidas') {
    if (tamano !== null) throw new AppError(`Las bebidas no llevan tamaño (${producto.nombre}).`, 400);
    return Number(producto.precio_venta);
  }
  throw new AppError(`El producto ${producto.nombre} tiene categoría o tipo no soportado para ventas.`, 400);
}

function validarProductosDeBase(lineas, productos) {
  if (productos.length !== lineas.length) throw new AppError('Uno o más productos no existen o no están disponibles.', 400);
  const porId = new Map(productos.map((producto) => [Number(producto.id_producto), producto]));
  return lineas.map((linea) => {
    const producto = porId.get(linea.idProducto);
    if (!producto || producto.estado !== 'Disponible' || !producto.categoria_activa) {
      throw new AppError('Uno o más productos no existen o no están disponibles.', 400);
    }
    const precio = precioYTamano(producto, linea.tamano);
    const subtotal = precio * linea.cantidad;
    if (!Number.isFinite(precio) || precio < 0 || !Number.isFinite(subtotal)) {
      throw new AppError('El precio calculado no es válido.', 400);
    }
    return { ...linea, producto, precio, subtotal };
  });
}

async function resolverClienteToken(client, idUsuario) {
  const { rows } = await client.query(
    `SELECT c.id_cliente
       FROM tb_cliente c
       JOIN tb_usuarios u ON u.id_usuario = c.id_usuario
       JOIN tb_roles r ON r.id_rol = u.id_rol
      WHERE c.id_usuario = $1 AND c.estado = TRUE AND u.estado = TRUE
        AND r.estado = TRUE AND r.nombre = 'Cliente'
      FOR UPDATE OF c`,
    [idUsuario]
  );
  if (!rows[0]) throw new AppError('La cuenta no tiene un perfil de cliente activo.', 403);
  return rows[0].id_cliente;
}

async function resolverOCrearClientePanel(client, datos) {
  // Serializa altas concurrentes del mismo documento incluso si todavía no existe fila que bloquear.
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`cliente-documento:${datos.numeroDocumento}`]);
  const { rows } = await client.query(
    `SELECT u.id_usuario, u.id_rol, r.nombre AS rol, c.id_cliente, c.estado AS cliente_estado
       FROM tb_usuarios u
       JOIN tb_roles r ON r.id_rol = u.id_rol
       LEFT JOIN tb_cliente c ON c.id_usuario = u.id_usuario
      WHERE u.id_usuario = $1
      FOR UPDATE OF u`,
    [datos.numeroDocumento]
  );
  if (rows[0]) {
    if (rows[0].rol !== 'Cliente') throw new AppError('El documento ya pertenece a una cuenta que no es cliente.', 409);
    if (!rows[0].id_cliente) {
      const creado = await client.query(
        'INSERT INTO tb_cliente (id_usuario) VALUES ($1) RETURNING id_cliente',
        [datos.numeroDocumento]
      );
      return creado.rows[0].id_cliente;
    }
    if (!rows[0].cliente_estado) throw new AppError('El cliente está inactivo.', 409);
    return rows[0].id_cliente;
  }
  const { rows: rolRows } = await client.query("SELECT id_rol FROM tb_roles WHERE nombre = 'Cliente' AND estado = TRUE");
  if (!rolRows[0]) throw new AppError('No está configurado el rol Cliente.', 500);
  // Alta solicitada desde Nuevo pedido sin correo: ambos campos quedan NULL como exige ck_usuarios_cuenta.
  await client.query(
    `INSERT INTO tb_usuarios (id_usuario, tipo_documento, nombre, correo, contrasena, id_rol)
     VALUES ($1, $2, $3, NULL, NULL, $4)`,
     [datos.numeroDocumento, datos.tipoDocumento, normalizarNombre(datos.nombre), rolRows[0].id_rol]
  );
  const cliente = await client.query(
    'INSERT INTO tb_cliente (id_usuario) VALUES ($1) RETURNING id_cliente',
    [datos.numeroDocumento]
  );
  return cliente.rows[0].id_cliente;
}

async function cargarProductosParaVenta(client, lineas) {
  const ids = lineas.map((linea) => linea.idProducto);
  const { rows } = await client.query(
    `SELECT p.id_producto, p.id_categoria, p.nombre, p.tipo, p.precio_venta,
            p.unidad_venta, p.stock, p.estado, c.nombre AS categoria_nombre,
            c.estado AS categoria_activa
       FROM tb_productos p
       JOIN tb_categoria_productos c ON c.id_categoria = p.id_categoria
      WHERE p.id_producto = ANY($1::integer[])
      ORDER BY p.id_producto
      FOR UPDATE OF p`,
    [ids]
  );
  return validarProductosDeBase(lineas, rows);
}

function mapearError(error) {
  if (error instanceof AppError) return error;
  if (error?.code === '23505') return new AppError('Ya existe un registro con esos datos.', 409);
  if (error?.code === '23503' || error?.code === '23514' || error?.code === '22P02') {
    console.error('Restricción/valor inválido en operación de ventas:', error.code, error.constraint);
    return new AppError('Los datos de la venta no cumplen las reglas de la base de datos.', 400);
  }
  console.error('Error de base de datos en ventas:', error?.code, error?.constraint);
  return new AppError('No se pudo completar la operación de ventas.', 503);
}

async function crearVentaEnTransaccion({ client, idCliente, horaRecogida, lineas, pago }) {
  const momento = validarFechaRecogida(horaRecogida);
  const productosCalculados = await cargarProductosParaVenta(client, lineas);
  const total = productosCalculados.reduce((suma, linea) => suma + linea.subtotal, 0);
  if (!Number.isFinite(total) || total < 0) throw new AppError('El total calculado no es válido.', 400);
  const venta = await client.query(
    `INSERT INTO tb_venta (id_cliente, fecha, hora_recogida, monto, estado, fecha_estado)
     VALUES ($1, $2, $3, $4, $5, $2) RETURNING id_venta, id_cliente, fecha, hora_recogida, monto, estado`,
    [idCliente, momento.timestamp, horaRecogida, total, ESTADOS_VENTA.POR_VERIFICAR]
  );
  const idVenta = venta.rows[0].id_venta;
  for (const linea of productosCalculados) {
    await client.query(
      `INSERT INTO tb_detalle_venta
         (id_venta, id_producto, cantidad, precio_unitario, sub_total, tamano)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [idVenta, linea.idProducto, linea.cantidad, linea.precio, linea.subtotal, linea.tamano]
    );
  }
  const montoPagadoInicial = total;
  const pagoInsertado = await client.query(
    `INSERT INTO tb_pagos
       (id_venta, tipo, comprobante, cantidad_pagar, depositado, faltante, estado)
     VALUES ($1, $2, $3, $4, $5, 0, 'Pendiente') RETURNING id_pago`,
    [idVenta, pago.tipo, pago.comprobante, total, montoPagadoInicial]
  );
  return { ...venta.rows[0], id_venta: Number(idVenta), pagos: [{ id_pago: Number(pagoInsertado.rows[0].id_pago), ...pago, depositado: montoPagadoInicial }] };
}

export async function crearVentaCliente(idUsuario, entrada) {
  try {
    return await transaction(async (client) => {
      const idCliente = await resolverClienteToken(client, idUsuario);
      return crearVentaEnTransaccion({ client, idCliente, ...entrada });
    });
  } catch (error) { throw mapearError(error); }
}

export async function crearVentaPanel(datosCliente, entrada) {
  try {
    return await transaction(async (client) => {
      const idCliente = await resolverOCrearClientePanel(client, datosCliente);
      return crearVentaEnTransaccion({ client, idCliente, ...entrada });
    });
  } catch (error) { throw mapearError(error); }
}

export async function verificarVenta(idVenta, datos) {
  let emailPendiente = null;
  try {
    const resultado = await transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT v.id_venta, v.id_cliente, v.fecha, v.hora_recogida, v.monto, v.estado,
                c.id_usuario, u.nombre, u.correo
           FROM tb_venta v
           JOIN tb_cliente c ON c.id_cliente = v.id_cliente
           JOIN tb_usuarios u ON u.id_usuario = c.id_usuario
          WHERE v.id_venta = $1
          FOR UPDATE OF v`,
        [idVenta]
      );
      const venta = rows[0];
      if (!venta) throw new AppError('Venta no encontrada.', 404);
      const accion = datos.accion;
      const hacia = accion === 'aceptar' ? ESTADOS_VENTA.POR_ENTREGAR
        : accion === 'monto_faltante' ? ESTADOS_VENTA.EN_ESPERA : ESTADOS_VENTA.ANULADO;
      if (!puedeTransicionarVenta(venta.estado, hacia)) {
        throw new AppError(`Transición no permitida: ${venta.estado} → ${hacia}.`, 409);
      }
      let ordenId = null;
      if (accion === 'aceptar') {
        await client.query(
          `UPDATE tb_pagos SET estado = 'Verificado', faltante = 0 WHERE id_venta = $1`,
          [idVenta]
        );
        ordenId = await crearOrdenProduccion(client, idVenta);
      } else if (accion === 'monto_faltante') {
        const pagado = Number(datos.pagado);
        const total = Number(venta.monto);
        if (pagado >= total) throw new AppError('El monto pagado debe ser menor al total; acepta la venta si está completo.', 400);
        const faltante = total - pagado;
        const { rows: pagos } = await client.query(
          `SELECT id_pago, depositado FROM tb_pagos WHERE id_venta = $1 ORDER BY id_pago DESC FOR UPDATE`,
          [idVenta]
        );
        if (!pagos.length) throw new AppError('La venta no tiene pagos registrados.', 409);
        const otrosDepositados = pagos.slice(1).reduce((suma, p) => suma + Number(p.depositado), 0);
        if (pagado < otrosDepositados) {
          throw new AppError('El monto pagado no puede ser inferior a pagos previamente registrados.', 400);
        }
        const depositoActual = Math.max(0, pagado - otrosDepositados);
        await client.query(
          `UPDATE tb_pagos SET cantidad_pagar = $1, depositado = $2, faltante = $3, estado = 'Pendiente'
            WHERE id_pago = $4`,
          [total, depositoActual, faltante, pagos[0].id_pago]
        );
        emailPendiente = {
          correo: venta.correo,
          nombre: venta.nombre,
          id: Number(venta.id_venta),
          total,
          pagado,
          faltante,
        };
      } else {
        if (!MOTIVOS_RECHAZO.includes(datos.motivo)) throw new AppError('El motivo de rechazo no es válido.', 400);
        await client.query(`UPDATE tb_pagos SET estado = 'Rechazado' WHERE id_venta = $1`, [idVenta]);
      }
      const { rows: actualizadas } = await client.query(
        `UPDATE tb_venta SET estado = $1, fecha_estado = $2, motivo_rechazo = $3
          WHERE id_venta = $4
          RETURNING id_venta, id_cliente, fecha, hora_recogida, monto, estado, fecha_estado, motivo_rechazo`,
        [hacia, fechaHoraBogota().timestamp, accion === 'rechazar' ? datos.motivo : null, idVenta]
      );
      return { ...actualizadas[0], id_orden_produccion: ordenId };
    });
    if (emailPendiente) void enviarAvisoMontoFaltante(emailPendiente);
    return resultado;
  } catch (error) { throw mapearError(error); }
}

export async function subirComprobanteCliente(idUsuario, idVenta, datos) {
  try {
    return await transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT v.id_venta, v.monto, v.estado, c.id_cliente
           FROM tb_venta v
           JOIN tb_cliente c ON c.id_cliente = v.id_cliente
          WHERE v.id_venta = $1 AND c.id_usuario = $2 AND c.estado = TRUE
          FOR UPDATE OF v`,
        [idVenta, idUsuario]
      );
      const venta = rows[0];
      if (!venta) throw new AppError('Venta no encontrada.', 404);
      if (!puedeTransicionarVenta(venta.estado, ESTADOS_VENTA.POR_VERIFICAR)) {
        throw new AppError('Solo puedes subir un comprobante cuando el pedido está En espera.', 409);
      }
      const { rows: pagos } = await client.query(
        `SELECT faltante FROM tb_pagos WHERE id_venta = $1 ORDER BY id_pago DESC LIMIT 1 FOR UPDATE`,
        [idVenta]
      );
      const saldoAnterior = Number(pagos[0]?.faltante ?? 0);
      if (saldoAnterior <= 0) throw new AppError('La venta no tiene un saldo pendiente registrado.', 409);
      await client.query(
        `INSERT INTO tb_pagos
           (id_venta, tipo, comprobante, cantidad_pagar, depositado, faltante, estado)
         VALUES ($1, $2, $3, $4, $4, 0, 'Pendiente')`,
        [idVenta, datos.tipo, datos.comprobante, saldoAnterior]
      );
      const { rows: actualizada } = await client.query(
        `UPDATE tb_venta SET estado = $1, fecha_estado = $2, motivo_rechazo = NULL
          WHERE id_venta = $3
          RETURNING id_venta, estado, fecha_estado, monto`,
        [ESTADOS_VENTA.POR_VERIFICAR, fechaHoraBogota().timestamp, idVenta]
      );
      return actualizada[0];
    });
  } catch (error) { throw mapearError(error); }
}

export async function listarVentas({ idUsuario = null, idVenta = null } = {}) {
  const where = [];
  const params = [];
  if (idUsuario) { params.push(idUsuario); where.push(`c.id_usuario = $${params.length}`); }
  if (idVenta) { params.push(idVenta); where.push(`v.id_venta = $${params.length}`); }
  const filtro = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT v.id_venta, v.id_cliente, v.fecha, v.hora_recogida, v.monto,
            v.estado, v.fecha_estado, v.motivo_rechazo,
            u.id_usuario, u.nombre AS cliente_nombre, u.tipo_documento,
            u.correo, u.telefono
       FROM tb_venta v
       JOIN tb_cliente c ON c.id_cliente = v.id_cliente
       JOIN tb_usuarios u ON u.id_usuario = c.id_usuario
       ${filtro}
      ORDER BY v.fecha DESC, v.id_venta DESC`,
    params
  );
  for (const venta of rows) {
    const [detalle, pagos] = await Promise.all([
      query(
        `SELECT dv.id_detalle_venta, dv.id_producto, p.nombre, p.imagen,
                dv.cantidad, dv.precio_unitario, dv.sub_total, dv.tamano
           FROM tb_detalle_venta dv JOIN tb_productos p ON p.id_producto = dv.id_producto
          WHERE dv.id_venta = $1 ORDER BY dv.id_detalle_venta`,
        [venta.id_venta]
      ),
      query(
        `SELECT id_pago, tipo, fecha, comprobante, cantidad_pagar, depositado, faltante, estado
           FROM tb_pagos WHERE id_venta = $1 ORDER BY id_pago`,
        [venta.id_venta]
      ),
    ]);
    venta.detalles = detalle.rows;
    venta.pagos = pagos.rows;
  }
  return rows;
}
