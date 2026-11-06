import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { startTestApp, type TestContext } from './support/testApp.js';

const CLAVE_ERRADA = 'clave-incorrecta';
const PROD_COOKIE = { path: '/api/auth', sameSite: 'strict', secure: true } as const;
const cookieHeader = (response: { headers: Headers }) =>
  response.headers.getSetCookie().find((value) => value.startsWith('autocheck_refresh=')) ?? '';

describe('Cookie de refresh detrás del rewrite /api/*', () => {
  let ctx: TestContext;
  before(async () => {
    ctx = await startTestApp({ config: { cookie: PROD_COOKIE } });
  });
  after(() => ctx.close());

  it('usa COOKIE_PATH, SameSite=Strict, Secure y HttpOnly', async () => {
    const response = await ctx.register('cookie@example.com');
    const header = cookieHeader(response);
    assert.match(header, /; Path=\/api\/auth(;|$)/);
    assert.match(header, /; HttpOnly/);
    assert.match(header, /; Secure/);
    assert.match(header, /; SameSite=Strict/);
    assert.match(header, /; Expires=/);
  });

  it('logout borra la cookie con la misma ruta y flags (si no, el navegador no la elimina)', async () => {
    const login = await ctx.login('cookie@example.com', 'contraseña-segura');
    const logout = await ctx.request('POST', '/auth/logout', { cookie: login.cookie });
    const header = cookieHeader(logout);
    assert.match(header, /^autocheck_refresh=;/);
    assert.match(header, /; Path=\/api\/auth(;|$)/);
    assert.match(header, /; SameSite=Strict/);
  });

  it('el refresh rota la cookie conservando la ruta', async () => {
    const login = await ctx.login('cookie@example.com', 'contraseña-segura');
    const refresh = await ctx.request('POST', '/auth/refresh', { cookie: login.cookie });
    assert.equal(refresh.status, 200);
    assert.match(cookieHeader(refresh), /; Path=\/api\/auth(;|$)/);
  });
});

describe('Rate limit con X-Forwarded-For', () => {
  const VERCEL_EDGE = '76.76.21.21';
  const attempt = (ctx: TestContext, forwardedFor: string, email = 'nadie@example.com') =>
    ctx.request('POST', '/auth/login', {
      body: { email, password: CLAVE_ERRADA },
      headers: { 'x-forwarded-for': forwardedFor }
    });

  describe('con TRUST_PROXY=2 (Vercel + Render)', () => {
    let ctx: TestContext;
    before(async () => {
      ctx = await startTestApp({ config: { trustProxy: 2 }, rateLimits: { loginMax: 2 } });
    });
    after(() => ctx.close());

    it('cuenta por la IP real del cliente, no por la de Vercel', async () => {
      assert.equal((await attempt(ctx, `1.1.1.1, ${VERCEL_EDGE}`)).status, 401);
      assert.equal((await attempt(ctx, `1.1.1.1, ${VERCEL_EDGE}`)).status, 401);
      assert.equal((await attempt(ctx, `1.1.1.1, ${VERCEL_EDGE}`)).status, 429);
      // Otro cliente detrás del mismo nodo de Vercel tiene su propio cupo.
      assert.equal((await attempt(ctx, `2.2.2.2, ${VERCEL_EDGE}`)).status, 401);
    });

    it('ignora IPs que el cliente antepone para falsificar el encabezado', async () => {
      assert.equal((await attempt(ctx, `9.9.9.9, 1.1.1.1, ${VERCEL_EDGE}`)).status, 429);
    });
  });

  describe('con TRUST_PROXY=0 (desarrollo)', () => {
    let ctx: TestContext;
    before(async () => {
      ctx = await startTestApp({ config: { trustProxy: 0 }, rateLimits: { loginMax: 2 } });
    });
    after(() => ctx.close());

    it('no confía en X-Forwarded-For: rotar el encabezado no evade el límite', async () => {
      assert.equal((await attempt(ctx, '3.3.3.3')).status, 401);
      assert.equal((await attempt(ctx, '4.4.4.4')).status, 401);
      assert.equal((await attempt(ctx, '5.5.5.5')).status, 429);
    });
  });

  describe('límite por correo', () => {
    let ctx: TestContext;
    before(async () => {
      ctx = await startTestApp({ config: { trustProxy: 2 }, rateLimits: { loginEmailMax: 2 } });
    });
    after(() => ctx.close());

    it('frena intentos contra la misma cuenta aunque cambie la IP', async () => {
      assert.equal((await attempt(ctx, `6.6.6.1, ${VERCEL_EDGE}`, 'victima@example.com')).status, 401);
      assert.equal((await attempt(ctx, `6.6.6.2, ${VERCEL_EDGE}`, 'VICTIMA@example.com')).status, 401);
      assert.equal((await attempt(ctx, `6.6.6.3, ${VERCEL_EDGE}`, 'victima@example.com')).status, 429);
      assert.equal((await attempt(ctx, `6.6.6.4, ${VERCEL_EDGE}`, 'otra@example.com')).status, 401);
    });
  });
});

describe('CORS con credentials', () => {
  let ctx: TestContext;
  before(async () => {
    ctx = await startTestApp({ config: { corsOrigins: ['https://autocheck.vercel.app'] } });
  });
  after(() => ctx.close());

  it('permite el origen configurado con credentials', async () => {
    const response = await ctx.request('GET', '/health', { headers: { origin: 'https://autocheck.vercel.app' } });
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://autocheck.vercel.app');
    assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
  });

  it('responde el preflight solo al origen permitido', async () => {
    const allowed = await ctx.request('OPTIONS', '/auth/login', {
      headers: {
        origin: 'https://autocheck.vercel.app',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type'
      }
    });
    assert.equal(allowed.status, 204);
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://autocheck.vercel.app');

    const denied = await ctx.request('OPTIONS', '/auth/login', {
      headers: { origin: 'https://sitio-ajeno.example', 'access-control-request-method': 'POST' }
    });
    assert.equal(denied.headers.get('access-control-allow-origin'), null);
  });

  it('no refleja orígenes ajenos', async () => {
    const response = await ctx.request('GET', '/health', { headers: { origin: 'https://sitio-ajeno.example' } });
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  });
});
