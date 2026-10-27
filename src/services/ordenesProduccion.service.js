import AppError from '../errors/AppError.js';
import { pool, query, transaction } from '../config/db.js';
import { calcularRequeridosProduccion, fechaHoraBogota } from '../utils/produccion.js';

const ESTADO_PENDIENTE = 'Pendiente';
const ESTADO_EN_PROCESO = 'En proceso';
const ESTADO_COMPLETADA = 'Completada';
const ESTADO_CANCELADA = 'Cancelada';
const TIPO_PREPARACION = 'Preparacion';
const TIPO_PEDIDO = 'Pedido';

function mapearError(error) {
  if (error instanceof AppError) return error;
  if (error?.code === '23505') return new AppError('Ya existe una orden con esos datos.', 409);
  if (error?.code === '23503') return new AppError('La orden o alguno de los registros relacionados no existe.', 400);
  if (error?.code === '23514' || error?.code === '23502' || error?.code === '22P02') {
    return new AppError('Los datos de la orden no cumplen las reglas de la base de datos.', 400);
  }
  console.error('Error de base de datos en órdenes de producción:', error?.code, error?.constraint);
  console.error(error);
  return new AppError('No se pudo completar la operación de producción.', 503);
}

function parsearArray(valor) {
  if (Array.isArray(valor)) return valor;
  if (valor == null || valor === '') return [];
  try {
    const parseado = typeof valor === 'string' ? JSON.parse(valor) : valor;
    return Array.isArray(parseado) ? parseado : [];
  } catch {
    return [];
  }
}

function numeroONull(valor) {
  return valor == null ? null : Number(valor);
}

function fechaSql(valor) {
  if (valor == null) return null;
  return valor instanceof Date ? valor.toISOString().slice(0, 10) : String(valor).slice(0, 10);
}

function mapearLinea(row) {
  return {
    id_detalle_op: Number(row.id_detalle_op),
    id_producto: row.id_producto == null ? null : Number(row.id_producto),
    id_insumo: row.id_insumo == null ? null : Number(row.id_insumo),
    id_ft: row.id_ft == null ? null : Number(row.id_ft),
    version_ficha: row.version_ficha == null ? null : Number(row.version_ficha),
    nombre: row.nombre,
    tamano: row.tamano,
    cantidad_estimada: Number(row.cantidad_estimada),
    cantidad_real: numeroONull(row.cantidad_real),
    merma: numeroONull(row.merma),
    unidad: row.unidad,
  };
}

async function cargarLineasOrden(client, idOrden) {
  const { rows } = await client.query(
    `SELECT d.id_detalle_op, d.id_producto, d.id_insumo, d.id_ft,
            ft.version AS version_ficha, d.nombre, d.tamano,
            d.cantidad_estimada, d.cantidad_real, d.merma, d.unidad
       FROM tb_detalle_orden_produccion d
       LEFT JOIN tb_ficha_tecnica ft ON ft.id_ft = d.id_ft
      WHERE d.id_orden_produccion = $1
      ORDER BY d.id_detalle_op`,
    [idOrden]
  );
  return rows.map(mapearLinea);
}

function mapearOrden(row, lineas) {
  const {
    venta_numero_resuelto: ventaNumeroResuelto,
    cliente_resuelto: clienteResuelto,
    ...orden
  } = row;
  const historial = parsearArray(orden.historial);
  const insumosRequeridos = parsearArray(orden.insumos_requeridos).map((item) => ({
    ...item,
    id_insumo: item.id_insumo == null ? null : Number(item.id_insumo),
    requerido: item.requerido == null ? null : Number(item.requerido),
    stock: item.stock == null ? null : Number(item.stock),
    falta: item.falta == null ? null : Number(item.falta),
  }));
  const numericos = [
    'id_orden_produccion', 'id_venta', 'tiempo_preparacion_min',
  ];
  for (const campo of numericos) orden[campo] = numeroONull(orden[campo]);
  orden.fecha_solicitada = fechaSql(orden.fecha_solicitada);
  orden.venta_numero = ventaNumeroResuelto ?? orden.venta_numero ?? null;
  orden.cliente = clienteResuelto ?? orden.cliente ?? null;
  orden.historial = historial;
  orden.insumos_requeridos = insumosRequeridos;
  orden.lineas = lineas;
  return orden;
}

async function obtenerOrdenEnConexion(client, idOrden, { bloquear = false } = {}) {
  const { rows } = await client.query(
    `SELECT op.*,
            COALESCE(NULLIF(op.venta_numero, ''), v.id_venta::text) AS venta_numero_resuelto,
            COALESCE(NULLIF(op.cliente, ''), u.nombre) AS cliente_resuelto
       FROM tb_orden_produccion op
       LEFT JOIN tb_venta v ON v.id_venta = op.id_venta
       LEFT JOIN tb_cliente c ON c.id_cliente = v.id_cliente
       LEFT JOIN tb_usuarios u ON u.id_usuario = c.id_usuario
      WHERE op.id_orden_produccion = $1
      ${bloquear ? 'FOR UPDATE OF op' : ''}`,
    [idOrden]
  );
  if (!rows[0]) throw new AppError('Orden de producción no encontrada.', 404);
  const lineas = await cargarLineasOrden(client, idOrden);
  return { row: rows[0], orden: mapearOrden(rows[0], lineas), lineas };
}

function validarFechaNoPasada(fecha) {
  if (fecha < fechaHoraBogota().fecha) throw new AppError('La fecha solicitada no puede ser pasada.', 400);
}

/** Líneas que participan en el cálculo y en el descuento de insumos: los
 *  productos insumo y los productos del menú que SÍ tienen ficha técnica.
 *  Un producto sin ficha es una línea "solo stock": no existe receta que
 *  descontar, así que no exige ingredientes y sólo mueve tb_productos.stock
 *  cuando la orden se completa. Se identifica porque su detalle se guarda con
 *  id_ft = NULL. */
const participaEnInsumos = (linea) => linea.id_insumo != null || linea.id_ft != null;

/**
 * Resuelve cada línea de la entrada a producto insumo o a producto 'Elaborado'
 * del menú. tb_insumo y tb_productos comparten rango de ids (hoy chocan siete
 * productos), así que la regla es:
 *   1. id_producto explícito → siempre el producto.
 *   2. id_insumo que existe como 'Producto insumo' → insumo (mantiene la
 *      pantalla de Órdenes tal cual funciona hoy).
 *   3. cualquier otro caso, si existe un producto con ese id → producto
 *      'Elaborado' (es como el frontend manda la cantidad inicial).
 */
async function resolverLineas(client, lineas) {
  const idsInsumo = [...new Set(lineas.map((linea) => linea.id_insumo).filter((id) => id != null))];
  const idsProducto = [...new Set(lineas.map((linea) => linea.id_producto).filter((id) => id != null))];

  const insumos = new Map();
  if (idsInsumo.length) {
    const { rows } = await client.query(
      `SELECT id_insumo, nombre, tipo, unidad_medida, estado
         FROM tb_insumo
        WHERE id_insumo = ANY($1::integer[])
        ORDER BY id_insumo
        FOR UPDATE`,
      [idsInsumo]
    );
    for (const row of rows) insumos.set(Number(row.id_insumo), row);
  }

  const candidatosProducto = new Set(idsProducto);
  for (const id of idsInsumo) {
    const insumo = insumos.get(id);
    if (!insumo || insumo.tipo !== 'Producto insumo') candidatosProducto.add(id);
  }

  const productos = new Map();
  const idsCandidatos = [...candidatosProducto].sort((a, b) => a - b);
  if (idsCandidatos.length) {
    const { rows } = await client.query(
      `SELECT id_producto, nombre, tipo, unidad_venta, estado
         FROM tb_productos
        WHERE id_producto = ANY($1::integer[])
        ORDER BY id_producto`,
      [idsCandidatos]
    );
    for (const row of rows) productos.set(Number(row.id_producto), row);
  }

  const pendientesInsumo = [];
  const pendientesProducto = [];
  const resueltas = new Array(lineas.length);
  for (let indice = 0; indice < lineas.length; indice += 1) {
    const linea = lineas[indice];
    const id = linea.id_producto ?? linea.id_insumo;
    if (linea.id_producto == null) {
      const insumo = insumos.get(id);
      if (insumo?.tipo === 'Producto insumo') {
        if (!insumo.estado) throw new AppError(`«${insumo.nombre}» debe ser un Producto insumo activo.`, 400);
        pendientesInsumo.push({ indice, linea, insumo });
        continue;
      }
    }
    const producto = productos.get(id);
    if (producto) {
      if (producto.tipo !== 'Elaborado') {
        throw new AppError(`«${producto.nombre}» debe ser un producto Elaborado.`, 400);
      }
      pendientesProducto.push({ indice, linea, producto });
      continue;
    }
    if (linea.id_producto != null) throw new AppError(`El producto ${id} no existe.`, 400);
    const insumo = insumos.get(id);
    if (insumo) throw new AppError(`«${insumo.nombre}» debe ser un Producto insumo activo.`, 400);
    throw new AppError('Uno o más productos insumo no existen.', 400);
  }

  // Ficha vigente del insumo: obligatoria (igual que siempre).
  const idsInsumoFicha = pendientesInsumo.map((pendiente) => pendiente.linea.id_insumo);
  const fichaPorInsumo = new Map();
  if (idsInsumoFicha.length) {
    const { rows } = await client.query(
      `SELECT id_ft, id_insumo
         FROM tb_ficha_tecnica
        WHERE id_insumo = ANY($1::integer[]) AND fecha_final IS NULL
        ORDER BY id_insumo, version DESC`,
      [idsInsumoFicha]
    );
    for (const ficha of rows) {
      if (!fichaPorInsumo.has(Number(ficha.id_insumo))) fichaPorInsumo.set(Number(ficha.id_insumo), Number(ficha.id_ft));
    }
  }
  for (const pendiente of pendientesInsumo) {
    const { indice, linea, insumo } = pendiente;
    const ficha = fichaPorInsumo.get(linea.id_insumo);
    if (!ficha) throw new AppError(`«${insumo.nombre}» no tiene ficha técnica vigente.`, 400);
    resueltas[indice] = {
      id_insumo: insumo.id_insumo,
      id_producto: null,
      id_ft: ficha,
      cantidad_estimada: Number(linea.cantidad),
      tamano: null,
      unidad: insumo.unidad_medida,
      nombre: insumo.nombre,
    };
  }

  // Ficha vigente del producto: OPCIONAL (si no hay, la línea es "solo stock").
  const idsProductoFicha = pendientesProducto.map((pendiente) => pendiente.linea.id_producto ?? pendiente.linea.id_insumo);
  const fichaPorProducto = new Map();
  if (idsProductoFicha.length) {
    const { rows } = await client.query(
      `SELECT id_ft, id_producto
         FROM tb_ficha_tecnica
        WHERE id_producto = ANY($1::integer[]) AND fecha_final IS NULL
        ORDER BY id_producto, version DESC`,
      [idsProductoFicha]
    );
    for (const ficha of rows) {
      if (!fichaPorProducto.has(Number(ficha.id_producto))) fichaPorProducto.set(Number(ficha.id_producto), Number(ficha.id_ft));
    }
  }
  for (const pendiente of pendientesProducto) {
    const { indice, linea, producto } = pendiente;
    const idProducto = producto.id_producto;
    resueltas[indice] = {
      id_insumo: null,
      id_producto: idProducto,
      id_ft: fichaPorProducto.get(Number(idProducto)) ?? null,
      cantidad_estimada: Number(linea.cantidad),
      tamano: null,
      unidad: producto.unidad_venta || 'und',
      nombre: producto.nombre,
    };
  }

  return resueltas;
}

/** Valida las líneas, calcula los insumos requeridos (sólo de las líneas que
 *  tienen receta) y devuelve además las filas de detalle a insertar, en el
 *  MISMO orden en que llegaron las líneas. */
async function prepararLineas(client, lineasEntrada, { bloquearInsumos = false } = {}) {
  const resueltas = await resolverLineas(client, lineasEntrada);
  const calculo = await calcularRequeridosProduccion(
    client,
    resueltas.filter(participaEnInsumos),
    { bloquearInsumos }
  );
  const detalle = [];
  let proximaReceta = 0;
  for (const linea of resueltas) {
    if (participaEnInsumos(linea) && proximaReceta < calculo.recetas.length) {
      detalle.push(calculo.recetas[proximaReceta]);
      proximaReceta += 1;
    } else {
      detalle.push(linea);
    }
  }
  return { calculo, detalle };
}

function lanzarErrorFaltantes(faltantes, mensaje) {
  if (!faltantes.length) return;
  const sinFicha = faltantes.find((faltante) => faltante.motivo?.includes('no tiene ficha técnica'));
  const error = new AppError(sinFicha?.motivo || mensaje, 409);
  error.faltantes = faltantes;
  throw error;
}

function detalleHistoria(historial, cambio) {
  const lista = parsearArray(historial);
  lista.push(cambio);
  return lista;
}

/** Inserta las líneas de detalle: cada fila lleva exactamente uno de
 *  id_insumo / id_producto (ck_dop_item) y siempre unidad y nombre. */
async function insertarDetallesPreparacion(client, idOrden, recetas) {
  for (const receta of recetas) {
    await client.query(
      `INSERT INTO tb_detalle_orden_produccion
         (id_orden_produccion, id_producto, id_insumo, id_ft,
          cantidad_estimada, unidad, nombre, tamano)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        idOrden,
        receta.id_producto ?? null,
        receta.id_insumo ?? null,
        receta.id_ft ?? null,
        receta.cantidad_estimada,
        receta.unidad || 'und',
        receta.nombre,
        receta.tamano ?? null,
      ]
    );
  }
}

/** Comparte creación transaccional para POST /ordenes-produccion y alta desde Insumos. */
export async function crearPreparacionEnTransaccion(client, datos, detalleInicial = null) {
  validarFechaNoPasada(datos.fecha_solicitada);
  const { calculo, detalle } = await prepararLineas(client, datos.lineas, { bloquearInsumos: true });
  lanzarErrorFaltantes(calculo.faltantes, 'No hay la cantidad suficiente de insumos. Por favor, disminuye la cantidad.');

  const momento = fechaHoraBogota();
  const historial = [{ de: null, a: ESTADO_PENDIENTE, fechaHora: momento.timestamp, detalle: detalleInicial }];
  const { rows } = await client.query(
    `INSERT INTO tb_orden_produccion
       (tipo, fecha_solicitada, hora_solicitada, estado, observacion,
        historial, insumos_requeridos, descripcion_preparacion,
        tiempo_preparacion_min, insumos_descontados, productos_descontados, stock_aplicado)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, FALSE, FALSE, FALSE)
     RETURNING id_orden_produccion`,
    [
      TIPO_PREPARACION,
      datos.fecha_solicitada,
      datos.hora_solicitada ?? null,
      ESTADO_PENDIENTE,
      datos.observacion ?? null,
      JSON.stringify(historial),
      JSON.stringify(calculo.requeridos),
      calculo.descripcion_preparacion,
      calculo.tiempo_preparacion_min,
    ]
  );
  const idOrden = Number(rows[0].id_orden_produccion);
  await insertarDetallesPreparacion(client, idOrden, detalle);
  return { id_orden_produccion: idOrden };
}

async function crearPreparacion(datos) {
  try {
    return await transaction(async (client) => {
      const creado = await crearPreparacionEnTransaccion(client, datos);
      return (await obtenerOrdenEnConexion(client, creado.id_orden_produccion)).orden;
    });
  } catch (error) {
    throw mapearError(error);
  }
}

export async function listarOrdenesProduccion(filtros) {
  const condiciones = [];
  const valores = [];
  if (filtros.estado !== undefined) {
    valores.push(filtros.estado);
    condiciones.push(`op.estado = $${valores.length}`);
  }
  if (filtros.tipo !== undefined) {
    valores.push(filtros.tipo);
    condiciones.push(`op.tipo = $${valores.length}`);
  }
  const { rows } = await query(
    `SELECT op.*,
            COALESCE(NULLIF(op.venta_numero, ''), v.id_venta::text) AS venta_numero_resuelto,
            COALESCE(NULLIF(op.cliente, ''), u.nombre) AS cliente_resuelto
       FROM tb_orden_produccion op
       LEFT JOIN tb_venta v ON v.id_venta = op.id_venta
       LEFT JOIN tb_cliente c ON c.id_cliente = v.id_cliente
       LEFT JOIN tb_usuarios u ON u.id_usuario = c.id_usuario
      ${condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : ''}
      ORDER BY op.fecha_creacion DESC, op.id_orden_produccion DESC`,
    valores
  );
  const ordenes = [];
  for (const row of rows) {
    const lineas = await cargarLineasOrden(pool, Number(row.id_orden_produccion));
    ordenes.push(mapearOrden(row, lineas));
  }
  return ordenes;
}

export async function obtenerOrdenProduccion(idOrden) {
  const { orden } = await obtenerOrdenEnConexion(pool, idOrden);
  return orden;
}

async function cargarDatosRequeridos(client, idOrden, bloquearInsumos = false) {
  const { row, lineas } = await obtenerOrdenEnConexion(client, idOrden);
  // Las líneas sin receta (productos sin ficha y las de un pedido, que es
  // calentamiento) no consumen insumos: no tienen nada que mostrar aquí.
  const calculo = await calcularRequeridosProduccion(client, lineas.filter(participaEnInsumos), { bloquearInsumos });
  return { row, lineas, calculo };
}

export async function obtenerRequeridosOrdenProduccion(idOrden) {
  const { calculo } = await cargarDatosRequeridos(pool, idOrden);
  return { requeridos: calculo.requeridos, faltantes: calculo.faltantes };
}

export async function crearOrdenProduccion(datos) {
  return crearPreparacion(datos);
}

export async function actualizarOrdenProduccion(idOrden, datos) {
  try {
    return await transaction(async (client) => {
      const { row, lineas } = await obtenerOrdenEnConexion(client, idOrden, { bloquear: true });
      if (row.estado !== ESTADO_PENDIENTE) throw new AppError('Solo se pueden editar órdenes Pendientes.', 409);
      if (row.tipo === TIPO_PEDIDO) {
        if (datos.lineas !== undefined) throw new AppError('No se pueden cambiar las líneas de un pedido.', 400);
        const camposNoPermitidos = Object.keys(datos).filter((campo) => campo !== 'observacion');
        if (camposNoPermitidos.length) throw new AppError('Un pedido Pendiente solo permite editar observacion.', 400);
        const observacion = datos.observacion !== undefined ? datos.observacion : row.observacion;
        await client.query('UPDATE tb_orden_produccion SET observacion = $2 WHERE id_orden_produccion = $1', [idOrden, observacion]);
        return (await obtenerOrdenEnConexion(client, idOrden)).orden;
      }
      if (row.tipo !== TIPO_PREPARACION) throw new AppError('Tipo de orden no soportado.', 409);

      const fechaSolicitada = datos.fecha_solicitada ?? fechaSql(row.fecha_solicitada);
      validarFechaNoPasada(fechaSolicitada);
      const horaSolicitada = datos.hora_solicitada !== undefined ? datos.hora_solicitada : row.hora_solicitada;
      const observacion = datos.observacion !== undefined ? datos.observacion : row.observacion;
      const lineasEntrada = datos.lineas ?? lineas.map((linea) => ({
        id_insumo: linea.id_insumo,
        id_producto: linea.id_producto,
        cantidad: linea.cantidad_estimada,
      }));
      const { calculo, detalle } = await prepararLineas(client, lineasEntrada, { bloquearInsumos: true });
      lanzarErrorFaltantes(calculo.faltantes, 'No hay la cantidad suficiente de insumos. Por favor, disminuye la cantidad.');

      await client.query('DELETE FROM tb_detalle_orden_produccion WHERE id_orden_produccion = $1', [idOrden]);
      await insertarDetallesPreparacion(client, idOrden, detalle);
      await client.query(
        `UPDATE tb_orden_produccion
            SET fecha_solicitada = $2, hora_solicitada = $3, observacion = $4,
                insumos_requeridos = $5::jsonb, descripcion_preparacion = $6,
                tiempo_preparacion_min = $7
          WHERE id_orden_produccion = $1`,
        [idOrden, fechaSolicitada, horaSolicitada, observacion, JSON.stringify(calculo.requeridos), calculo.descripcion_preparacion, calculo.tiempo_preparacion_min]
      );
      return (await obtenerOrdenEnConexion(client, idOrden)).orden;
    });
  } catch (error) {
    throw mapearError(error);
  }
}

export async function eliminarOrdenProduccion(idOrden) {
  try {
    return await transaction(async (client) => {
      const { rows } = await client.query(
        'SELECT id_orden_produccion, tipo, estado FROM tb_orden_produccion WHERE id_orden_produccion = $1 FOR UPDATE',
        [idOrden]
      );
      const orden = rows[0];
      if (!orden) throw new AppError('Orden de producción no encontrada.', 404);
      if (orden.tipo === TIPO_PEDIDO) throw new AppError('Un pedido no se elimina: usa Dar de baja', 409);
      if (orden.tipo !== TIPO_PREPARACION || orden.estado !== ESTADO_PENDIENTE) {
        throw new AppError('Solo se pueden eliminar preparaciones Pendientes.', 409);
      }
      const { rows: noConformes } = await client.query(
        'SELECT EXISTS (SELECT 1 FROM tb_productos_no_conformes WHERE id_orden_produccion = $1) AS tiene_registros',
        [idOrden]
      );
      if (noConformes[0].tiene_registros) throw new AppError('No se puede eliminar la orden: tiene registros de productos no conformes.', 409);
      await client.query('DELETE FROM tb_orden_produccion WHERE id_orden_produccion = $1', [idOrden]);
      return { message: 'Orden de producción eliminada.' };
    });
  } catch (error) {
    throw mapearError(error);
  }
}

async function descontarInsumos(client, lineas) {
  const calculo = await calcularRequeridosProduccion(client, lineas, { bloquearInsumos: true });
  if (calculo.faltantes.length) {
    lanzarErrorFaltantes(calculo.faltantes, 'Inventario insuficiente');
  }
  for (const requerido of calculo.requeridos) {
    const { rowCount } = await client.query(
      `UPDATE tb_insumo
          SET stock_actual = stock_actual - $2
        WHERE id_insumo = $1 AND estado = TRUE AND stock_actual >= $2`,
      [requerido.id_insumo, requerido.requerido]
    );
    if (!rowCount) {
      const error = new AppError('Inventario insuficiente', 409);
      error.faltantes = [requerido];
      throw error;
    }
  }
  for (const receta of calculo.recetas) {
    if (receta.id_producto != null && receta.id_detalle_op != null) {
      await client.query('UPDATE tb_detalle_orden_produccion SET id_ft = $2 WHERE id_detalle_op = $1', [receta.id_detalle_op, receta.id_ft]);
    }
  }
  return calculo;
}

export async function iniciarOrdenProduccion(idOrden) {
  try {
    return await transaction(async (client) => {
      const { row, lineas } = await obtenerOrdenEnConexion(client, idOrden, { bloquear: true });
      if (row.estado !== ESTADO_PENDIENTE) throw new AppError('Solo se pueden iniciar órdenes Pendientes.', 409);
      // Un 'Pedido' es un encargo de CALENTAMIENTO: sus productos elaborados ya
      // descontaron sus insumos cuando esas unidades se hornearon, así que la
      // fase de descuento no aplica. La marca queda en TRUE para que nadie
      // (completar incluido) intente descontar insumos después.
      const esPedido = row.tipo === TIPO_PEDIDO;
      const calculo = esPedido
        ? { requeridos: parsearArray(row.insumos_requeridos) }
        : await descontarInsumos(client, lineas.filter(participaEnInsumos));
      const historial = detalleHistoria(row.historial, {
        de: ESTADO_PENDIENTE,
        a: ESTADO_EN_PROCESO,
        fechaHora: fechaHoraBogota().timestamp,
        ...(esPedido ? { detalle: 'Pedido (calentamiento): sin descuento de insumos.' } : {}),
      });
      await client.query(
        `UPDATE tb_orden_produccion
            SET estado = $2, fecha_en_proceso = now() AT TIME ZONE 'America/Bogota',
                insumos_requeridos = $3::jsonb, insumos_descontados = TRUE, historial = $4::jsonb
          WHERE id_orden_produccion = $1`,
        [idOrden, ESTADO_EN_PROCESO, JSON.stringify(calculo.requeridos), JSON.stringify(historial)]
      );
      return (await obtenerOrdenEnConexion(client, idOrden)).orden;
    });
  } catch (error) {
    throw mapearError(error);
  }
}

async function descontarSiHaceFalta(client, row, lineas) {
  if (row.insumos_descontados) return { requeridos: parsearArray(row.insumos_requeridos) };
  const calculo = await descontarInsumos(client, lineas);
  await client.query(
    `UPDATE tb_orden_produccion
        SET insumos_requeridos = $2::jsonb, insumos_descontados = TRUE
      WHERE id_orden_produccion = $1`,
    [row.id_orden_produccion, JSON.stringify(calculo.requeridos)]
  );
  return calculo;
}

/** Categoría de un producto del menú para el registro de merma (Pizza, Lasaña…). */
async function categoriaDeProducto(client, idProducto) {
  const { rows } = await client.query(
    `SELECT c.nombre
       FROM tb_productos p
       JOIN tb_categoria_productos c ON c.id_categoria = p.id_categoria
      WHERE p.id_producto = $1`,
    [idProducto]
  );
  return String(rows[0]?.nombre ?? '').slice(0, 100) || null;
}

export async function completarOrdenProduccion(idOrden, datos) {
  try {
    return await transaction(async (client) => {
      const { row, lineas } = await obtenerOrdenEnConexion(client, idOrden, { bloquear: true });
      if (row.estado !== ESTADO_EN_PROCESO) throw new AppError('Solo se pueden completar órdenes En proceso.', 409);

      if (row.tipo === TIPO_PEDIDO) {
        if (datos.lineas !== null) throw new AppError('La finalización de un pedido no recibe líneas ni cantidades reales.', 400);
      } else if (row.tipo === TIPO_PREPARACION) {
        if (!Array.isArray(datos.lineas) || datos.lineas.length !== lineas.length) {
          throw new AppError('Debes enviar la cantidad real de todas las líneas de la preparación.', 400);
        }
        const detalleIds = new Set(lineas.map((linea) => linea.id_detalle_op));
        if (datos.lineas.some((linea) => !detalleIds.has(linea.id_detalle_op))) {
          throw new AppError('Las líneas enviadas no corresponden a esta orden.', 400);
        }
      } else {
        throw new AppError('Tipo de orden no soportado.', 409);
      }

      // El insumo sólo se descuenta en preparaciones: un pedido ya descontó
      // (o no aplica) y nunca vuelve a tocar inventario al completarse.
      if (row.tipo === TIPO_PREPARACION && !row.insumos_descontados) {
        await descontarSiHaceFalta(client, row, lineas.filter(participaEnInsumos));
      }

      if (row.tipo === TIPO_PREPARACION && !row.stock_aplicado) {
        const cantidades = new Map(datos.lineas.map((linea) => [linea.id_detalle_op, linea.cantidad_real]));
        for (const linea of lineas) {
          const cantidadReal = cantidades.get(linea.id_detalle_op);
          const merma = Math.max(0, linea.cantidad_estimada - cantidadReal);
          // Preparación con línea de producto: lo producido entra como
          // pre-hechas de ese producto del menú (tb_productos.stock).
          const esProducto = linea.id_producto != null;
          const { rowCount } = esProducto
            ? await client.query(
                `UPDATE tb_productos
                    SET stock = stock + ROUND($2::numeric)::int
                  WHERE id_producto = $1 AND tipo = 'Elaborado'`,
                [linea.id_producto, cantidadReal]
              )
            : await client.query(
                `UPDATE tb_insumo
                    SET stock_actual = stock_actual + $2
                  WHERE id_insumo = $1 AND tipo = 'Producto insumo'`,
                [linea.id_insumo, cantidadReal]
              );
          if (!rowCount) throw new AppError(`No se pudo actualizar el stock de «${linea.nombre}».`, 409);
          await client.query(
            `UPDATE tb_detalle_orden_produccion
                SET cantidad_real = $2, merma = $3
              WHERE id_detalle_op = $1`,
            [linea.id_detalle_op, cantidadReal, merma]
          );
          if (merma > 0) {
            // Merma como producto no conforme (la pantalla CPN solo recarga).
            // No mueve stock: al inventario solo entró la cantidad real. Es un
            // registro del sistema (motivo «Merma de cocina» + orden enlazada),
            // así que no se puede borrar desde el módulo CPN.
            const categoria = esProducto
              ? await categoriaDeProducto(client, linea.id_producto)
              : 'Producto insumo';
            await client.query(
              `INSERT INTO tb_productos_no_conformes
                 (fecha_registro, tipo_no_conformidad, id_producto, id_insumo, id_orden_produccion,
                  id_venta, cantidad_afectada, unidad_medida, motivo, descripcion_detallada,
                  estado, nombre, categoria, area_proceso, orden_ref)
               VALUES ($1, $2, $3, $4, $5, NULL, $6, $7,
                       'Merma de cocina', $8, 'Pendiente', $9, $10, 'Producción', $11)`,
              [
                fechaHoraBogota().fecha,
                esProducto ? 'Producto' : 'Producto insumo',
                linea.id_producto,
                linea.id_insumo,
                idOrden,
                merma,
                linea.unidad,
                `Se planificaron ${linea.cantidad_estimada} ${linea.unidad} y se obtuvieron ${cantidadReal} ${linea.unidad}.`.slice(0, 500),
                String(linea.nombre ?? '').slice(0, 200),
                categoria,
                String(idOrden),
              ]
            );
          }
        }
      }

      const historial = detalleHistoria(row.historial, {
        de: ESTADO_EN_PROCESO,
        a: ESTADO_COMPLETADA,
        fechaHora: fechaHoraBogota().timestamp,
      });
      await client.query(
        `UPDATE tb_orden_produccion
            SET estado = $2, fecha_completada = now() AT TIME ZONE 'America/Bogota',
                stock_aplicado = CASE WHEN tipo = 'Preparacion' THEN TRUE ELSE stock_aplicado END,
                historial = $3::jsonb
          WHERE id_orden_produccion = $1`,
        [idOrden, ESTADO_COMPLETADA, JSON.stringify(historial)]
      );
      return (await obtenerOrdenEnConexion(client, idOrden)).orden;
    });
  } catch (error) {
    throw mapearError(error);
  }
}

export async function darBajaOrdenProduccion(idOrden, datos) {
  try {
    return await transaction(async (client) => {
      const { row } = await obtenerOrdenEnConexion(client, idOrden, { bloquear: true });
      if (![ESTADO_PENDIENTE, ESTADO_EN_PROCESO].includes(row.estado)) {
        throw new AppError('Solo se pueden dar de baja órdenes Pendientes o En proceso.', 409);
      }
      const historial = detalleHistoria(row.historial, {
        de: row.estado,
        a: ESTADO_CANCELADA,
        fechaHora: fechaHoraBogota().timestamp,
        detalle: `${datos.motivo}: ${datos.descripcion}`,
      });
      await client.query(
        `UPDATE tb_orden_produccion
            SET estado = $2, fecha_cancelada = now() AT TIME ZONE 'America/Bogota', historial = $3::jsonb
          WHERE id_orden_produccion = $1`,
        [idOrden, ESTADO_CANCELADA, JSON.stringify(historial)]
      );
      return (await obtenerOrdenEnConexion(client, idOrden)).orden;
    });
  } catch (error) {
    throw mapearError(error);
  }
}
