import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import jwt from 'jsonwebtoken';
import { startTestApp, TEST_ACCESS_SECRET, type TestContext } from './support/testApp.js';

describe('Middleware de autenticación', () => {
  let ctx: TestContext;
  let userToken: string;

  before(async () => {
    ctx = await startTestApp();
    userToken = await ctx.registerVerified('usuario@example.com');
  });
  after(() => ctx.close());

  it('deja /health público', async () => {
    const response = await ctx.request('GET', '/health');
    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'ok');
  });

  it('exige token en /garage/*', async () => {
    for (const [method, path] of [['GET', '/garage'], ['GET', '/garage/ABC-123'], ['POST', '/garage']] as const) {
      const response = await ctx.request(method, path, { body: method === 'POST' ? { plate: 'ABC-123' } : undefined });
      assert.equal(response.status, 401, `${method} ${path}`);
    }
  });

  it('rechaza tokens inválidos, expirados, con otro secreto o sin firma', async () => {
    const payload = { email: 'usuario@example.com', role: 'admin' };
    const options = { subject: '00000000-0000-4000-8000-000000000000', issuer: 'autocheck-api', audience: 'autocheck-app' };
    const tokens = [
      'no-es-un-jwt',
      jwt.sign(payload, TEST_ACCESS_SECRET, { ...options, expiresIn: -10 }),
      jwt.sign(payload, 'otro-secreto-de-al-menos-32-caracteres!!', options),
      jwt.sign(payload, '', { ...options, algorithm: 'none' })
    ];
    for (const token of tokens) {
      assert.equal((await ctx.request('GET', '/garage', { token })).status, 401);
    }
  });

  it('permite consultar el garaje con un token válido', async () => {
    const response = await ctx.request('GET', '/garage', { token: userToken });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.vehicles, []);
  });

  it('valida la placa con zod', async () => {
    const response = await ctx.request('GET', '/garage/ABC1234', { token: userToken });
    assert.equal(response.status, 400);
    assert.equal(response.body.errors[0].field, 'plate');
  });

  it('las rutas de demostración /vehicles ya no existen', async () => {
    for (const [method, path] of [['GET', '/vehicles'], ['GET', '/vehicles/ABC-1234'], ['POST', '/vehicles/scan'], ['PATCH', '/vehicles/ABC-1234/inspections']] as const) {
      assert.equal((await ctx.request(method, path, { token: userToken, body: method === 'GET' ? undefined : {} })).status, 404, `${method} ${path}`);
    }
  });

  it('responde 400 con JSON mal formado y 404 en rutas desconocidas', async () => {
    const malformed = await ctx.request('POST', '/auth/login', { rawBody: '{"email": ' });
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.message, 'El cuerpo de la solicitud no es JSON válido.');
    assert.equal((await ctx.request('GET', '/no-existe')).status, 404);
  });
});
