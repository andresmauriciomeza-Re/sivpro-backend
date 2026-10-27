import AppError from '../errors/AppError.js';

const normalizarNombre = (valor) => {
  const excepciones = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e']);
  return String(valor ?? '').trim().toLocaleLowerCase('es').split(/\s+/).filter(Boolean)
    .map((palabra, indice) => indice > 0 && excepciones.has(palabra) ? palabra : palabra.charAt(0).toLocaleUpperCase('es') + palabra.slice(1)).join(' ');
};
import { query, transaction } from '../config/db.js';
import { RECARGO_PIZZA_GRANDE, ZONA_HORARIA_NEGOCIO, ESTADOS_VENTA, SEGUNDOS_ANULACION, MINUTOS_PREPARACION_PANEL, puedeTransicionarVenta } from '../config/ventas.js';
import normalizarCategoria from '../utils/normalizarCategoria.js';
import { enviarAvisoMontoFaltante } from './mail.service.js';
import { crearOrdenProduccion, cancelarOrdenProduccionDeVenta } from './ordenProduccion.service.js';
import { validarMotivoRechazo, validarMotivoAnulacion, validarResolverDevolucion } from '../validators/ventas.validator.js';

/** Marca quién deja la venta en estado Anulado. El rechazo de la verificación
    lo hace siempre el panel; la anulación del panel usa 'Administrador' y la
    cancelación que hace el propio cliente desde "Mis pedidos" usa 'Cliente'. */
const ANULADO_POR_ADMIN = 'Administrador';
const ANULADO_POR_CLIENTE = 'Cliente';

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

function validarFechaRecogida(hora) {
  const actual = fechaHoraBogota();
  const [horas, minutos] = hora.split(':').map(Number);
  const minutosRecogida = horas * 60 + minutos;
  if (horas < 12 || minutosRecogida <= actual.minutos) {
    throw new AppError('La hora de recogida debe ser posterior a la hora actual de Colombia y en horario PM.', 400);
  }
  return actual;
}

/** Pedidos del panel: el formulario no pide hora, así que se auto-asigna
    "ahora + MINUTOS_PREPARACION_PANEL" (lo que demora la pizza), en el mismo
    formato HH:mm:ss que espera tb_venta.hora_recogida. */
function horaAutoPreparacion() {
  const actual = fechaHoraBogota();
  const minutos = actual.minutos + MINUTOS_PREPARACION_PANEL;
  const hora = Math.floor(minutos / 60) % 24;
  const minuto = minutos % 60;
  return `${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}:00`;
}

function precioYTamano(producto, tamano) {
  const categoria = normalizarCategoria(producto.categoria_nombre);
  const tipo = producto.tipo;
  if (tipo === 'Elaborado' && categoria === 'pizza') {
    if (!['Mediana', 'Grande'].includes(tamano)) throw new AppError(`Selecciona Mediana o Grande para ${producto.nombre}.`, 400);
    if (tamano === 'Grande') {
      return producto.precio_grande == null
        ? Number(producto.precio_venta) + RECARGO_PIZZA_GRANDE
        : Number(producto.precio_grande);
    }
    return Number(producto.precio_venta);
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
  const porId = new Map(productos.map((producto) => [Number(producto.id_producto), producto]));
  if (lineas.some((linea) => {
    const producto = porId.get(linea.idProducto);
    return !producto || producto.estado !== 'Disponible' || !producto.categoria_activa;
  })) {
    throw new AppError('Uno o más productos no existen o no están disponibles.', 400);
  }

  const cantidadesReventa = new Map();
  for (const linea of lineas) {
    const producto = porId.get(linea.idProducto);
    if (producto.tipo === 'Reventa') {
      cantidadesReventa.set(linea.idProducto, (cantidadesReventa.get(linea.idProducto) || 0) + linea.cantidad);
    }
  }
  for (const [idProducto, cantidad] of cantidadesReventa) {
    const producto = porId.get(idProducto);
    const stock = Number(producto.stock);
    if (cantidad > stock) {
      throw new AppError(
        stock === 0
          ? `«${producto.nombre}» está agotado`
          : `Solo quedan ${stock} unidades de «${producto.nombre}»`,
        409
      );
    }
  }

  return lineas.map((linea) => {
    const producto = porId.get(linea.idProducto);
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
            p.unidad_venta, p.stock, p.precio_grande, p.estado, c.nombre AS categoria_nombre,
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
  console.error(error);
  return new AppError('No se pudo completar la operación de ventas.', 503);
}

async function crearVentaEnTransaccion({ client, idCliente, horaRecogida, lineas, pago }) {
  // El panel ya no pide hora (pedido tomado en el local): si no viene, se
  // auto-asigna "ahora + MINUTOS_PREPARACION_PANEL". La validación de PM y
  // hora futura aplica sólo cuando el cliente sí eligió hora en el checkout.
  const horaFinal = horaRecogida || horaAutoPreparacion();
  const momento = horaRecogida ? validarFechaRecogida(horaRecogida) : fechaHoraBogota();
  const productosCalculados = await cargarProductosParaVenta(client, lineas);
  const total = productosCalculados.reduce((suma, linea) => suma + linea.subtotal, 0);
  if (!Number.isFinite(total) || total < 0) throw new AppError('El total calculado no es válido.', 400);
  const venta = await client.query(
    `INSERT INTO tb_venta (id_cliente, fecha, hora_recogida, monto, estado, fecha_estado)
     VALUES ($1, $2, $3, $4, $5, $2) RETURNING id_venta, id_cliente, fecha, hora_recogida, monto, estado`,
    [idCliente, momento.timestamp, horaFinal, total, ESTADOS_VENTA.POR_VERIFICAR]
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
      let motivoRechazo = null;
      let anuladoPor = null;
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
          `SELECT id_pago, depositado, tipo FROM tb_pagos WHERE id_venta = $1 ORDER BY id_pago DESC FOR UPDATE`,
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
          // Medio con el que pagó el cliente: el QR del correo codifica esa
          // misma cuenta (fallback Nequi si no quedó registrado).
          tipo: pagos[0].tipo,
        };
      } else {
        // Rechazo: motivo obligatorio (lista válida o "Otro: <texto>"), pagos
        // marcados como Rechazado y la venta queda a nombre de quien rechazó.
        motivoRechazo = validarMotivoRechazo(datos.motivo);
        anuladoPor = ANULADO_POR_ADMIN;
        await client.query(`UPDATE tb_pagos SET estado = 'Rechazado' WHERE id_venta = $1`, [idVenta]);
      }
      const { rows: actualizadas } = await client.query(
        `UPDATE tb_venta SET estado = $1, fecha_estado = $2, motivo_rechazo = $3, anulado_por = $4
          WHERE id_venta = $5
          RETURNING id_venta, id_cliente, fecha, hora_recogida, monto, estado, fecha_estado, motivo_rechazo, anulado_por`,
        [hacia, fechaHoraBogota().timestamp, motivoRechazo, anuladoPor, idVenta]
      );
      return { ...actualizadas[0], id_orden_produccion: ordenId };
    });
    if (emailPendiente) void enviarAvisoMontoFaltante(emailPendiente);
    return resultado;
  } catch (error) { throw mapearError(error); }
}

/** Devolución que corresponde según el motivo de la anulación: "Cliente canceló
    el pedido" deja el 20 % en la pizzería (se devuelve el 80 %); el error del
    local, la falta de producto y "Otro" devuelven el 100 % del total. */
const porcentajeReembolso = (motivo) => (motivo === 'Cliente canceló el pedido' ? 0.8 : 1);

/**
 * Anula una venta desde el listado del panel, TODO en una sola transacción:
 *
 * 1. bloquea la fila y exige un estado anulable (Por verificar, En espera o
 *    Por entregar) y menos de 10 minutos desde `tb_venta.fecha`. Los 10
 *    minutos se miden AQUÍ, contra el reloj de la base en la misma convención
 *    con la que se guardó esa fecha (hora naive de Bogotá), nunca con el
 *    reloj del navegador.
 * 2. deja la venta en 'Anulado' con `motivo_rechazo`, `anulado_por` =
 *    'Administrador', `monto_reembolso` y `comprobante_anulacion`, y marca
 *    sus pagos como 'Rechazado'.
 * 3. si la venta ya estaba "Por entregar", cancela su orden de producción
 *    (estado 'Cancelada' con fecha_cancelada) y le devuelve al stock las
 *    bebidas que esa orden había descontado, y los elaborados (pre-hechas)
 *    sólo si esa orden descontó stock (productos_descontados).
 */
export async function anularVenta(idVenta, datos) {
  try {
    return await transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT v.id_venta, v.fecha, v.monto, v.estado,
                EXTRACT(EPOCH FROM ((now() AT TIME ZONE 'America/Bogota') - v.fecha)) AS transcurridos
           FROM tb_venta v
          WHERE v.id_venta = $1
          FOR UPDATE OF v`,
        [idVenta]
      );
      const venta = rows[0];
      if (!venta) throw new AppError('Venta no encontrada.', 404);
      if (!puedeTransicionarVenta(venta.estado, ESTADOS_VENTA.ANULADO)) {
        throw new AppError(`Transición no permitida: ${venta.estado} → Anulado.`, 409);
      }
      const transcurridos = Number(venta.transcurridos ?? 0);
      if (!Number.isFinite(transcurridos) || transcurridos >= SEGUNDOS_ANULACION) {
        throw new AppError('Solo se puede anular en los primeros 10 minutos después de crear la venta.', 409);
      }

      const motivo = validarMotivoAnulacion(datos.motivo);
      const monto = Number(venta.monto);
      const montoReembolso = Math.round(monto * porcentajeReembolso(motivo) * 100) / 100;

      const idOrdenCancelada = venta.estado === ESTADOS_VENTA.POR_ENTREGAR
        ? await cancelarOrdenProduccionDeVenta(client, idVenta)
        : null;
      await client.query(`UPDATE tb_pagos SET estado = 'Rechazado' WHERE id_venta = $1`, [idVenta]);

      const { rows: actualizada } = await client.query(
        `UPDATE tb_venta
            SET estado = $1, fecha_estado = $2, motivo_rechazo = $3, anulado_por = $4,
                monto_reembolso = $5, comprobante_anulacion = $6
          WHERE id_venta = $7
          RETURNING id_venta, id_cliente, fecha, hora_recogida, monto, estado, fecha_estado,
                    motivo_rechazo, anulado_por, monto_reembolso, comprobante_anulacion`,
        [
          ESTADOS_VENTA.ANULADO,
          fechaHoraBogota().timestamp,
          motivo,
          ANULADO_POR_ADMIN,
          montoReembolso,
          datos.comprobante ?? null,
          idVenta,
        ]
      );
      return { ...actualizada[0], id_orden_produccion_cancelada: idOrdenCancelada };
    });
  } catch (error) { throw mapearError(error); }
}

/** Cancelación del cliente desde "Mis pedidos": mismo camino que
    `anularVenta` pero sin permiso de panel. Sólo la dueña de la venta puede
    hacerlo, dentro de los primeros 10 minutos, con el motivo fijo
    'Cliente canceló el pedido' (reembolso del 80 %) y `anulado_por='Cliente'`,
    que es lo que el panel pinta como "Cancelado por el cliente". */
export const MOTIVO_CANCELACION_CLIENTE = 'Cliente canceló el pedido';

export async function cancelarVentaCliente(idVenta, idUsuario) {
  try {
    return await transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT v.id_venta, v.fecha, v.monto, v.estado,
                EXTRACT(EPOCH FROM ((now() AT TIME ZONE 'America/Bogota') - v.fecha)) AS transcurridos
           FROM tb_venta v
           JOIN tb_cliente c ON c.id_cliente = v.id_cliente
          WHERE v.id_venta = $1 AND c.id_usuario = $2 AND c.estado = TRUE
          FOR UPDATE OF v`,
        [idVenta, idUsuario]
      );
      const venta = rows[0];
      // Mismo mensaje en "no existe" y "no es tuya": no se filtra qué ventas
      // existen para otros usuarios.
      if (!venta) throw new AppError('Venta no encontrada.', 404);
      if (!puedeTransicionarVenta(venta.estado, ESTADOS_VENTA.ANULADO)) {
        throw new AppError(`Tu pedido ${idVenta} ya no se puede cancelar (${venta.estado}).`, 409);
      }
      const transcurridos = Number(venta.transcurridos ?? 0);
      if (!Number.isFinite(transcurridos) || transcurridos >= SEGUNDOS_ANULACION) {
        throw new AppError('Solo puedes cancelar el pedido en los primeros 10 minutos.', 409);
      }
      const montoReembolso = Math.round(Number(venta.monto) * 0.8 * 100) / 100;
      const idOrdenCancelada = venta.estado === ESTADOS_VENTA.POR_ENTREGAR
        ? await cancelarOrdenProduccionDeVenta(client, idVenta)
        : null;
      await client.query(`UPDATE tb_pagos SET estado = 'Rechazado' WHERE id_venta = $1`, [idVenta]);
      const { rows: actualizada } = await client.query(
        `UPDATE tb_venta
            SET estado = $1, fecha_estado = $2, motivo_rechazo = $3, anulado_por = $4,
                monto_reembolso = $5, comprobante_anulacion = NULL
          WHERE id_venta = $6
          RETURNING id_venta, id_cliente, fecha, hora_recogida, monto, estado, fecha_estado,
                    motivo_rechazo, anulado_por, monto_reembolso`,
        [
          ESTADOS_VENTA.ANULADO,
          fechaHoraBogota().timestamp,
          MOTIVO_CANCELACION_CLIENTE,
          ANULADO_POR_CLIENTE,
          montoReembolso,
          idVenta,
        ]
      );
      return { ...actualizada[0], id_orden_produccion_cancelada: idOrdenCancelada };
    });
  } catch (error) { throw mapearError(error); }
}

/** Devolución (§6): el panel marca una venta COMO devuelta y queda pendiente
    de gestionar. Sólo cambia el estado de la venta y abre la fila en
    tb_devolucion; el detalle y la venta de reemplazo se registran al
    confirmar, en `resolverDevolucion`. */
export async function marcarDevolucion(idVenta) {
  try {
    return await transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT id_venta, estado FROM tb_venta WHERE id_venta = $1 FOR UPDATE`,
        [idVenta]
      );
      const venta = rows[0];
      if (!venta) throw new AppError('Venta no encontrada.', 404);
      // Idempotente: si la venta YA está en Devolucion sólo se asegura la fila
      // (caso de una devolución marcada antes de que existiera tb_devolucion).
      if (venta.estado !== ESTADOS_VENTA.DEVOLUCION
        && !puedeTransicionarVenta(venta.estado, ESTADOS_VENTA.DEVOLUCION)) {
        throw new AppError(`Transición no permitida: ${venta.estado} → Devolucion.`, 409);
      }
      // Idempotente: si ya tenía devolución abierta, no se duplica la fila.
      const { rows: existente } = await client.query(
        `SELECT id_devolucion FROM tb_devolucion WHERE id_venta = $1 LIMIT 1`,
        [idVenta]
      );
      let idDevolucion = existente[0] ? Number(existente[0].id_devolucion) : null;
      if (!idDevolucion) {
        // Fecha explícita en hora de Bogotá (igual que tb_venta.fecha): el
        // DEFAULT now() de la BD guardaría UTC en Neon y descuadraría el día.
        const { rows: creada } = await client.query(
          `INSERT INTO tb_devolucion (id_venta, fecha, tipo, monto, nota, estado)
           VALUES ($1, $2, 'Devuelta', 0, NULL, 'Pendiente')
           RETURNING id_devolucion`,
          [idVenta, fechaHoraBogota().timestamp]
        );
        idDevolucion = Number(creada[0].id_devolucion);
      }
      const { rows: actualizada } = await client.query(
        `UPDATE tb_venta SET estado = $1, fecha_estado = $2
          WHERE id_venta = $3
          RETURNING id_venta, id_cliente, fecha, hora_recogida, monto, estado, fecha_estado`,
        [ESTADOS_VENTA.DEVOLUCION, fechaHoraBogota().timestamp, idVenta]
      );
      return { ...actualizada[0], id_devolucion: idDevolucion };
    });
  } catch (error) { throw mapearError(error); }
}

/** Resolución de una devolución: registra línea por línea lo que devuelve el
    cliente (tb_detalle_devolucion) y, si hay canje, crea la NUEVA VENTA del
    mismo cliente con esos productos + su orden de producción. Ese era el
    hueco del flujo: el canje sólo creaba la orden, sin venta asociada, así
    que la pizzería entregaba producto sin registrar ingreso ni pedido.
    La venta de reemplazo nace "Por entregar" con su pago ya verificado (el
    cliente ya pagó el original) y `tb_devolucion.id_venta_reemplazo` la
    enlaza para siempre. */
export async function resolverDevolucion(idDevolucion, datos) {
  try {
    return await transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT d.id_devolucion, d.id_venta, d.estado,
                v.id_cliente, v.estado AS venta_estado, v.hora_recogida
           FROM tb_devolucion d
           JOIN tb_venta v ON v.id_venta = d.id_venta
          WHERE d.id_devolucion = $1
          FOR UPDATE OF d, v`,
        [idDevolucion]
      );
      const dev = rows[0];
      if (!dev) throw new AppError('Devolución no encontrada.', 404);
      if (dev.estado === 'Resuelta') throw new AppError('La devolución ya fue resuelta.', 409);
      if (dev.venta_estado !== ESTADOS_VENTA.DEVOLUCION) {
        throw new AppError(`La venta ${dev.id_venta} no está en estado Devolucion.`, 409);
      }

      const entrada = validarResolverDevolucion(datos);
      const { tipo, nota, lineas, canje, monto } = entrada;

      // El producto de reemplazo debe existir y estar Disponible ANTES de
      // insertar el detalle: si no, la FK de id_producto_reemplazo revienta
      // con un 23503 genérico en vez de un mensaje claro.
      const idsReemplazo = [...new Set(
        lineas.map((linea) => linea.idProductoReemplazo).filter((id) => id != null),
      )];
      if (idsReemplazo.length > 0) {
        const { rows: reemplazos } = await client.query(
          `SELECT id_producto FROM tb_productos
            WHERE id_producto = ANY($1::integer[]) AND estado = 'Disponible'`,
          [idsReemplazo],
        );
        if (reemplazos.length !== idsReemplazo.length) {
          throw new AppError('El producto de reemplazo no existe o no está disponible.', 400);
        }
      }

      // ── 1. Detalle de lo devuelto, por línea de la venta original ──
      for (const linea of lineas) {
        const { rows: detalle } = await client.query(
          `SELECT dv.id_detalle_venta, dv.id_venta, dv.precio_unitario, dv.id_producto, dv.tamano,
                  p.nombre AS producto_nombre, p.unidad_venta, c.nombre AS categoria_nombre
             FROM tb_detalle_venta dv
             JOIN tb_productos p ON p.id_producto = dv.id_producto
             JOIN tb_categoria_productos c ON c.id_categoria = p.id_categoria
            WHERE dv.id_detalle_venta = $1 AND dv.id_venta = $2
            FOR UPDATE OF dv`,
          [linea.idDetalleVenta, dev.id_venta]
        );
        if (!detalle[0]) {
          throw new AppError(`El detalle ${linea.idDetalleVenta} no pertenece a la venta ${dev.id_venta}.`, 409);
        }
        await client.query(
          `INSERT INTO tb_detalle_devolucion
             (id_devolucion, id_detalle_venta, cantidad, precio, sub_total,
              motivo, descripcion_motivo, id_producto_reemplazo, cantidad_reemplazo, tamano_reemplazo)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            idDevolucion,
            linea.idDetalleVenta,
            linea.cantidad,
            detalle[0].precio_unitario,
            Number(detalle[0].precio_unitario) * linea.cantidad,
            linea.motivo,
            linea.descripcionMotivo,
            linea.idProductoReemplazo,
            linea.cantidadReemplazo,
            linea.tamanoReemplazo,
          ]
        );

        // «Producto malo» = pérdida en venta: queda como producto no conforme
        // (tipo Venta) en la misma transacción. No mueve stock.
        if (linea.motivo === 'Producto malo') {
          const fila = detalle[0];
          const nombre = fila.tamano ? `${fila.producto_nombre} — ${fila.tamano}` : fila.producto_nombre;
          await client.query(
            `INSERT INTO tb_productos_no_conformes
               (fecha_registro, tipo_no_conformidad, id_producto, id_venta, cantidad_afectada,
                unidad_medida, motivo, descripcion_detallada, estado, nombre, categoria,
                area_proceso, venta_ref)
             VALUES ($1, 'Venta', $2, $3, $4, $5, 'Pérdida en venta', $6, 'Pendiente', $7, $8,
                     'Ventas', $9)`,
            [
              fechaHoraBogota().fecha,
              fila.id_producto,
              dev.id_venta,
              linea.cantidad,
              fila.unidad_venta,
              String(linea.descripcionMotivo || `Devolución #${idDevolucion}: producto malo`).slice(0, 500),
              String(nombre).slice(0, 200),
              String(fila.categoria_nombre ?? '').slice(0, 100) || null,
              String(dev.id_venta),
            ]
          );
        }
      }

      // ── 2. Venta de reemplazo del canje (lo que recibe el cliente) ──
      let idVentaReemplazo = null;
      let ordenReemplazo = null;
      if (canje.length > 0) {
        // Precios y disponibilidad con la misma rutina que una venta normal.
        const lineasCanje = canje.map((linea) => ({
          idProducto: linea.idProducto,
          cantidad: linea.cantidad,
          tamano: linea.tamano,
        }));
        const calculadas = await cargarProductosParaVenta(client, lineasCanje);
        const totalCanje = calculadas.reduce((suma, linea) => suma + linea.subtotal, 0);
        const momento = fechaHoraBogota();
        const horaReemplazo = horaAutoPreparacion();

        const { rows: ventaCreada } = await client.query(
          `INSERT INTO tb_venta (id_cliente, fecha, hora_recogida, monto, estado, fecha_estado)
           VALUES ($1, $2, $3, $4, $5, $2)
           RETURNING id_venta`,
          [dev.id_cliente, momento.timestamp, horaReemplazo, totalCanje, ESTADOS_VENTA.POR_ENTREGAR]
        );
        idVentaReemplazo = Number(ventaCreada[0].id_venta);

        for (const linea of calculadas) {
          await client.query(
            `INSERT INTO tb_detalle_venta
               (id_venta, id_producto, cantidad, precio_unitario, sub_total, tamano)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [idVentaReemplazo, linea.idProducto, linea.cantidad, linea.precio, linea.subtotal, linea.tamano]
          );
        }
        // El cliente ya pagó el pedido original: el pago del reemplazo queda
        // cubierto, para que la venta no aparezca exigiendo verificación.
        await client.query(
          `INSERT INTO tb_pagos
             (id_venta, tipo, comprobante, cantidad_pagar, depositado, faltante, estado)
           VALUES ($1, 'Efectivo', NULL, $2, $2, 0, 'Verificado')`,
          [idVentaReemplazo, totalCanje]
        );
        // Su orden de producción: el canje entra a cocina como cualquier pedido.
        ordenReemplazo = await crearOrdenProduccion(client, idVentaReemplazo);
      }

      // ── 3. Cierre de la devolución ──
      await client.query(
        `UPDATE tb_devolucion
            SET tipo = $1, monto = $2, nota = $3, estado = 'Resuelta', id_venta_reemplazo = $4
          WHERE id_devolucion = $5`,
        [tipo, monto, nota, idVentaReemplazo, idDevolucion]
      );

      return {
        id_devolucion: idDevolucion,
        id_venta: Number(dev.id_venta),
        id_venta_reemplazo: idVentaReemplazo,
        id_orden_reemplazo: ordenReemplazo,
        tipo,
        monto,
        nota,
      };
    });
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
        `UPDATE tb_venta SET estado = $1, fecha_estado = $2, motivo_rechazo = NULL, anulado_por = NULL
          WHERE id_venta = $3
          RETURNING id_venta, estado, fecha_estado, monto`,
        [ESTADOS_VENTA.POR_VERIFICAR, fechaHoraBogota().timestamp, idVenta]
      );
      return actualizada[0];
    });
  } catch (error) { throw mapearError(error); }
}

/** Avance automático "Por entregar → Completado".
    Regla de negocio: el estado cambia SOLO cuando llega la hora de recogida
    (fecha del pedido + hora_recogida), nunca por un botón. Se ejecuta al
    listar (panel o "mis pedidos"), así que no hace falta cron ni job: la
    siguiente carga ya refleja el cambio y el Dashboard lo cuenta como ingreso.
    `fecha` es timestamp naive de Bogotá, igual que `now() AT TIME ZONE`, así
    que la comparación es directa. Devuelve cuántas ventas avanzaron. */
export async function avanzarVentasCompletadas() {
  const { rowCount } = await query(
    `UPDATE tb_venta
        SET estado = $1, fecha_estado = now() AT TIME ZONE $2
      WHERE estado = $3
        AND hora_recogida IS NOT NULL
        AND (fecha::date + hora_recogida + CASE WHEN hora_recogida < fecha::time THEN interval '1 day' ELSE interval '0' END) <= now() AT TIME ZONE $2`,
    [ESTADOS_VENTA.COMPLETADO, ZONA_HORARIA_NEGOCIO, ESTADOS_VENTA.POR_ENTREGAR]
  );
  return rowCount;
}

export async function listarVentas({ idUsuario = null, idVenta = null } = {}) {
  // El avance por hora se resuelve aquí mismo (pull perezoso): la lista que se
  // va a devolver ya trae las ventas cuya hora de recogida ya pasó.
  await avanzarVentasCompletadas();
  const where = [];
  const params = [];
  if (idUsuario) { params.push(idUsuario); where.push(`c.id_usuario = $${params.length}`); }
  if (idVenta) { params.push(idVenta); where.push(`v.id_venta = $${params.length}`); }
  const filtro = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT v.id_venta, v.id_cliente, v.fecha, v.hora_recogida, v.monto,
            v.estado, v.fecha_estado, v.motivo_rechazo,
            v.anulado_por, v.monto_reembolso, v.comprobante_anulacion,
            d.id_devolucion, d.fecha AS devolucion_fecha,
            d.estado AS devolucion_estado, d.tipo AS devolucion_tipo,
            d.monto AS devolucion_monto, d.nota AS devolucion_nota,
            d.id_venta_reemplazo,
            GREATEST(0, ${SEGUNDOS_ANULACION}
                     - EXTRACT(EPOCH FROM ((now() AT TIME ZONE 'America/Bogota') - v.fecha))
            )::integer AS segundos_restantes_anulacion,
            u.id_usuario, u.nombre AS cliente_nombre, u.tipo_documento,
            u.correo, u.telefono
       FROM tb_venta v
       JOIN tb_cliente c ON c.id_cliente = v.id_cliente
       JOIN tb_usuarios u ON u.id_usuario = c.id_usuario
       LEFT JOIN tb_devolucion d ON d.id_venta = v.id_venta
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
    // Motivos por línea de la devolución (si la venta tiene una), en el mismo
    // formato que usa el panel y "Mis pedidos": { [índice de línea]: motivo }.
    if (venta.id_devolucion) {
      const { rows: lineasDev } = await query(
        `SELECT dd.id_detalle_venta, dd.motivo, dd.descripcion_motivo
           FROM tb_detalle_devolucion dd
          WHERE dd.id_devolucion = $1
          ORDER BY dd.id_detalle_dev`,
        [venta.id_devolucion]
      );
      venta.devolucion_lineas = lineasDev;
    }
  }
  return rows;
}
