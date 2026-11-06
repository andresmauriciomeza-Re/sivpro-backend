import assert from 'node:assert/strict';
import test from 'node:test';
import { pool } from '../src/config/db.js';
import { crearProductoNoConforme, eliminarProductoNoConforme } from '../src/services/productosNoConformes.service.js';

test('no conforme de un insumo con cantidad 0.5 descuenta exactamente 0.5', async () => {
  const insumo = { id_insumo: 4, nombre: 'Harina', tipo: 'Insumo', stock_actual: '3.000', unidad_medida: 'kg' };
  let stock = Number(insumo.stock_actual);
  let consultaDescuento = null;
  const client = {
    async query(sql, params = []) {
      const consulta = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      if (consulta === 'begin' || consulta === 'commit' || consulta === 'rollback') return { rows: [] };
      if (consulta.startsWith('select id_insumo, nombre, tipo, stock_actual')) return { rows: [{ ...insumo }] };
      if (consulta.startsWith('update tb_insumo set stock_actual')) {
        consultaDescuento = consulta;
        assert.deepEqual(params, [4, 0.5]);
        stock = Math.max(0, stock - params[1]);
        return { rows: [], rowCount: 1 };
      }
      if (consulta.startsWith('insert into tb_productos_no_conformes')) {
        return { rows: [{ id_producto_no_conforme: 9 }] };
      }
      if (consulta.includes('from tb_productos_no_conformes pnc')) {
        return {
          rows: [{
            id_producto_no_conforme: 9,
            tipo_no_conformidad: 'Producto insumo',
            id_insumo: 4,
            cantidad_afectada: '0.5',
          }],
        };
      }
      throw new Error(`Consulta no esperada en prueba: ${consulta}`);
    },
    release() {},
  };
  const conectarOriginal = pool.connect;
  pool.connect = async () => client;
  try {
    const registro = await crearProductoNoConforme({
      tipo_no_conformidad: 'Producto insumo',
      id_insumo: 4,
      cantidad_afectada: 0.5,
    });

    assert.equal(registro.cantidad_afectada, 0.5);
  } finally {
    pool.connect = conectarOriginal;
  }
  assert.equal(stock, 2.5);
  assert.match(consultaDescuento, /\$2::numeric/);
  assert.doesNotMatch(consultaDescuento, /::int/);
});

test('no conforme de pizza descuenta y devuelve partes compartidas', async () => {
  let stock = 24;
  const registro = { id_producto_no_conforme: 9, tipo_no_conformidad: 'Producto', id_producto: 7,
    cantidad_afectada: 2, tamano: 'Grande', estado: 'Pendiente', motivo: 'Daño' };
  const client = {
    async query(sql, params = []) {
      const consulta = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      if (['begin', 'commit', 'rollback'].includes(consulta)) return { rows: [] };
      if (consulta.startsWith('select p.id_producto, p.nombre')) return { rows: [{
        id_producto: 7, nombre: 'Pizza', tipo: 'Elaborado', categoria: 'Pizza', stock_partes: stock,
      }] };
      if (consulta.startsWith('update tb_productos set stock_partes')) {
        assert.equal(params[1], 8);
        assert.match(consulta, /\$2::int/);
        stock += consulta.includes(' - ') ? -params[1] : params[1];
        return { rows: [], rowCount: 1 };
      }
      if (consulta.startsWith('insert into tb_productos_no_conformes')) return { rows: [{ id_producto_no_conforme: 9 }] };
      if (consulta.includes('from tb_productos_no_conformes pnc')) return { rows: [registro] };
      if (consulta.startsWith('delete from tb_productos_no_conformes')) return { rows: [] };
      throw new Error(`Consulta no esperada en prueba: ${consulta}`);
    },
    release() {},
  };
  const anterior = pool.connect;
  pool.connect = async () => client;
  try {
    await crearProductoNoConforme({ tipo_no_conformidad: 'Producto', id_producto: 7, cantidad_afectada: 2, tamano: 'Grande' });
    assert.equal(stock, 16);
    await eliminarProductoNoConforme(9);
    assert.equal(stock, 24);
  } finally {
    pool.connect = anterior;
  }
});
