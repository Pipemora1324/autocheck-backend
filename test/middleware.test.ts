import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import jwt from 'jsonwebtoken';
import { DEFAULT_CLAVE, startTestApp, TEST_ACCESS_SECRET, type TestContext } from './support/testApp.js';

describe('Middleware de autenticación y roles', () => {
  let ctx: TestContext;
  let userToken: string;
  let adminToken: string;

  before(async () => {
    ctx = await startTestApp();
    userToken = await ctx.registerVerified('usuario@example.com');
    await ctx.registerVerified('admin@example.com');
    ctx.users.setRole('admin@example.com', 'admin');
    adminToken = (await ctx.login('admin@example.com', DEFAULT_CLAVE)).body.accessToken;
  });
  after(() => ctx.close());

  it('deja /health público', async () => {
    const response = await ctx.request('GET', '/health');
    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'ok');
  });

  it('exige token en /vehicles/*', async () => {
    for (const [method, path] of [['GET', '/vehicles'], ['GET', '/vehicles/ABC-1234'], ['POST', '/vehicles/scan']] as const) {
      const response = await ctx.request(method, path, { body: method === 'POST' ? { plate: 'ABC-1234' } : undefined });
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
      assert.equal((await ctx.request('GET', '/vehicles', { token })).status, 401);
    }
  });

  it('permite consultar vehículos con un token válido', async () => {
    const response = await ctx.request('GET', '/vehicles', { token: userToken });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.vehicles.map((vehicle: { plate: string }) => vehicle.plate), ['ABC-1234', 'DEF-5678', 'GHI-9012']);
  });

  it('valida la placa con zod', async () => {
    const response = await ctx.request('GET', '/vehicles/ABC1234', { token: userToken });
    assert.equal(response.status, 400);
    assert.equal(response.body.errors[0].field, 'plate');

    const scan = await ctx.request('POST', '/vehicles/scan', { token: userToken, body: { plate: ' abc-1234 ', source: 'image' } });
    assert.equal(scan.status, 201);
    assert.equal(scan.body.plate, 'ABC-1234');
  });

  it('solo un admin puede actualizar inspecciones', async () => {
    const body = { inspectionId: 'steering', status: 'Aprobado', result: 'Revisión completada', notes: 'Suspensión validada.' };
    const asUser = await ctx.request('PATCH', '/vehicles/ABC-1234/inspections', { token: userToken, body });
    assert.equal(asUser.status, 403);
  });

  it('toma updatedBy del usuario autenticado e ignora el del body', async () => {
    const body = {
      inspectionId: 'steering',
      status: 'Aprobado',
      result: 'Revisión completada',
      notes: 'Suspensión validada.',
      updatedBy: 'suplantador@example.com'
    };
    const response = await ctx.request('PATCH', '/vehicles/ABC-1234/inspections', { token: adminToken, body });
    assert.equal(response.status, 200);
    const steering = response.body.inspections.find((item: { id: string }) => item.id === 'steering');
    assert.equal(steering.status, 'Aprobado');
    assert.equal(steering.updatedBy, 'admin@example.com');
  });

  it('valida el cuerpo de la actualización de inspección', async () => {
    const response = await ctx.request('PATCH', '/vehicles/ABC-1234/inspections', {
      token: adminToken,
      body: { inspectionId: 'steering', status: 'Excelente', result: '', notes: 'x' }
    });
    assert.equal(response.status, 400);
    assert.deepEqual(response.body.errors.map((error: { field: string }) => error.field).sort(), ['result', 'status']);
  });

  it('responde 400 con JSON mal formado y 404 en rutas desconocidas', async () => {
    const malformed = await ctx.request('POST', '/auth/login', { rawBody: '{"email": ' });
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.message, 'El cuerpo de la solicitud no es JSON válido.');
    assert.equal((await ctx.request('GET', '/no-existe')).status, 404);
  });
});
