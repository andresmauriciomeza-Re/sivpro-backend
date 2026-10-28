import assert from 'node:assert/strict';
import { test } from 'node:test';
import jwt from 'jsonwebtoken';
import { pool } from '../src/config/db.js';
import { verificarToken } from '../src/middlewares/auth.js';

const SECRET = 'test-secret-session-invalidation';

async function verificar(token, t, usuario) {
  const secretoAnterior = process.env.JWT_SECRET;
  t.after(() => {
    if (secretoAnterior === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = secretoAnterior;
  });
  process.env.JWT_SECRET = SECRET;
  t.mock.method(pool, 'query', async () => ({ rows: [usuario] }));

  const req = {
    headers: { authorization: `Bearer ${token}` },
  };
  const resultado = await new Promise((resolve) => {
    verificarToken(req, {}, (error) => resolve({ error, usuario: req.usuario }));
  });
  return resultado;
}

test('una contraseña cambiada invalida tokens con una versión anterior', async (t) => {
  const tokenAnterior = jwt.sign({ sub: 'usuario-prueba', tv: 0 }, SECRET, {
    algorithm: 'HS256',
    expiresIn: '1h',
  });
  const { error } = await verificar(tokenAnterior, t, {
    id_usuario: 'usuario-prueba',
    estado: true,
    token_version: 1,
    rol: 'Cliente',
    rol_estado: true,
  });

  assert.equal(error?.statusCode, 401);
  assert.equal(error?.code, 'SESION_INVALIDADA');
});

test('un token antiguo sin tv sigue válido cuando token_version es cero', async (t) => {
  const tokenAnterior = jwt.sign({ sub: 'usuario-prueba' }, SECRET, {
    algorithm: 'HS256',
    expiresIn: '1h',
  });
  const { error, usuario } = await verificar(tokenAnterior, t, {
    id_usuario: 'usuario-prueba',
    estado: true,
    token_version: 0,
    rol: 'Cliente',
    rol_estado: true,
  });

  assert.equal(error, undefined);
  assert.equal(usuario.id, 'usuario-prueba');
  assert.equal(usuario.rol, 'Cliente');
});

test('un token vencido responde con el código TOKEN_EXPIRADO', async (t) => {
  const tokenVencido = jwt.sign({ sub: 'usuario-prueba' }, SECRET, {
    algorithm: 'HS256',
    expiresIn: -1,
  });
  const { error } = await verificar(tokenVencido, t, {
    id_usuario: 'usuario-prueba',
    estado: true,
    token_version: 0,
    rol: 'Cliente',
    rol_estado: true,
  });

  assert.equal(error?.statusCode, 401);
  assert.equal(error?.code, 'TOKEN_EXPIRADO');
});
