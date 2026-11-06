import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { FORGOT_PASSWORD_MESSAGE } from '../src/controllers/authController.js';
import {
  hashOneTimeToken,
  INVALID_CREDENTIALS,
  INVALID_RESET_TOKEN,
  RESET_TOKEN_TTL_MS
} from '../src/services/authService.js';
import { startTestApp, type TestContext } from './support/testApp.js';

describe('Registro', () => {
  let ctx: TestContext;
  before(async () => {
    ctx = await startTestApp();
  });
  after(() => ctx.close());

  it('crea la cuenta, normaliza el correo y entrega access token y cookie de refresh', async () => {
    const response = await ctx.register('  Nuevo.Usuario@Example.COM ');
    assert.equal(response.status, 201);
    assert.equal(response.body.user.email, 'nuevo.usuario@example.com');
    assert.equal(response.body.user.role, 'user');
    assert.equal(response.body.expiresIn, 900);
    assert.ok(ctx.tokens.verifyAccessToken(response.body.accessToken));
    assert.ok(response.cookie);
    assert.equal(response.body.passwordHash, undefined);

    const stored = await ctx.users.findByEmail('nuevo.usuario@example.com');
    assert.match(stored!.passwordHash, /^\$argon2id\$/);

    const setCookie = response.headers.getSetCookie().join(';').toLowerCase();
    assert.match(setCookie, /httponly/);
    assert.match(setCookie, /path=\/auth/);
  });

  it('rechaza un correo ya registrado', async () => {
    await ctx.register('duplicado@example.com');
    const response = await ctx.register('DUPLICADO@example.com');
    assert.equal(response.status, 409);
  });

  it('exige contraseñas de al menos 8 caracteres y un correo válido', async () => {
    const short = await ctx.register('corta@example.com', '1234567');
    assert.equal(short.status, 400);
    assert.equal(short.body.errors[0].field, 'password');

    const invalid = await ctx.register('no-es-correo', 'contraseña-segura');
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.errors[0].field, 'email');
  });
});

describe('Login, sesión y logout', () => {
  let ctx: TestContext;
  before(async () => {
    ctx = await startTestApp();
    await ctx.register('ana@example.com', 'clave-correcta');
  });
  after(() => ctx.close());

  it('inicia sesión con credenciales correctas', async () => {
    const response = await ctx.login('ANA@example.com', 'clave-correcta');
    assert.equal(response.status, 200);
    assert.equal(response.body.user.email, 'ana@example.com');

    const me = await ctx.request('GET', '/auth/me', { token: response.body.accessToken });
    assert.equal(me.status, 200);
    assert.equal(me.body.user.email, 'ana@example.com');
  });

  it('responde el mismo error genérico con contraseña errónea o correo inexistente', async () => {
    const wrongPassword = await ctx.login('ana@example.com', 'otra-clave');
    const unknownEmail = await ctx.login('nadie@example.com', 'otra-clave');
    assert.equal(wrongPassword.status, 401);
    assert.equal(unknownEmail.status, 401);
    assert.equal(wrongPassword.body.message, INVALID_CREDENTIALS);
    assert.deepEqual(wrongPassword.body, unknownEmail.body);
  });

  it('rota el refresh token y detecta su reutilización', async () => {
    const login = await ctx.login('ana@example.com', 'clave-correcta');
    const first = login.cookie!;

    const rotated = await ctx.request('POST', '/auth/refresh', { cookie: first });
    assert.equal(rotated.status, 200);
    assert.ok(rotated.body.accessToken);
    assert.ok(rotated.cookie);
    assert.notEqual(rotated.cookie, first);

    // Reutilizar el token anterior revoca toda la cadena, incluido el token nuevo.
    const reused = await ctx.request('POST', '/auth/refresh', { cookie: first });
    assert.equal(reused.status, 401);
    const afterReuse = await ctx.request('POST', '/auth/refresh', { cookie: rotated.cookie });
    assert.equal(afterReuse.status, 401);
  });

  it('logout revoca el refresh token y borra la cookie', async () => {
    const login = await ctx.login('ana@example.com', 'clave-correcta');
    const logout = await ctx.request('POST', '/auth/logout', { cookie: login.cookie });
    assert.equal(logout.status, 204);
    assert.match(logout.headers.getSetCookie().join(';'), /autocheck_refresh=;/);

    const refresh = await ctx.request('POST', '/auth/refresh', { cookie: login.cookie });
    assert.equal(refresh.status, 401);
  });

  it('rechaza refresh sin cookie o con un token manipulado', async () => {
    assert.equal((await ctx.request('POST', '/auth/refresh')).status, 401);
    assert.equal((await ctx.request('POST', '/auth/refresh', { cookie: 'autocheck_refresh=abc.def.ghi' })).status, 401);
  });
});

describe('Recuperación de contraseña', () => {
  let ctx: TestContext;
  before(async () => {
    ctx = await startTestApp();
    await ctx.register('maria@example.com', 'clave-original');
  });
  after(() => ctx.close());

  const forgot = (email: string) => ctx.request('POST', '/auth/forgot-password', { body: { email } });
  const reset = (token: string, password: string) =>
    ctx.request('POST', '/auth/reset-password', { body: { token, password } });
  const login = (password: string) =>
    ctx.request('POST', '/auth/login', { body: { email: 'maria@example.com', password } });

  it('responde lo mismo exista o no el correo, y solo envía correo si existe', async () => {
    const sentBefore = ctx.mailer.sent.length;
    const existing = await forgot('maria@example.com');
    const missing = await forgot('no-existe@example.com');
    assert.equal(existing.status, 202);
    assert.equal(missing.status, 202);
    assert.deepEqual(existing.body, missing.body);
    assert.equal(existing.body.message, FORGOT_PASSWORD_MESSAGE);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(ctx.mailer.sent.length, sentBefore + 1);
    assert.equal(ctx.mailer.sent.at(-1)!.to, 'maria@example.com');
  });

  it('guarda solo el hash sha256 del token y el enlace apunta a APP_URL/reset-password', async () => {
    await forgot('maria@example.com');
    await new Promise((resolve) => setImmediate(resolve));
    const { resetUrl } = ctx.mailer.sent.at(-1)!;
    assert.match(resetUrl, /^http:\/\/localhost:4200\/reset-password\?token=/);

    const token = ctx.mailer.lastToken();
    const stored = ctx.resetTokens.tokens.at(-1)!;
    assert.equal(stored.tokenHash, hashOneTimeToken(token));
    assert.ok(!ctx.resetTokens.tokens.some((row) => row.tokenHash === token));
    assert.equal(stored.expiresAt.getTime() - ctx.clock.now.getTime(), RESET_TOKEN_TTL_MS);
  });

  it('flujo completo: restablece la contraseña, invalida otros tokens y cierra sesiones', async () => {
    const session = await login('clave-original');
    const user = (await ctx.users.findByEmail('maria@example.com'))!;
    assert.ok(ctx.refreshTokens.activeCount(user.id) > 0);

    await forgot('maria@example.com');
    await new Promise((resolve) => setImmediate(resolve));
    const olderToken = ctx.mailer.lastToken();
    await forgot('maria@example.com');
    await new Promise((resolve) => setImmediate(resolve));
    const newestToken = ctx.mailer.lastToken();

    const response = await reset(newestToken, 'clave-nueva-123');
    assert.equal(response.status, 200);

    assert.equal((await login('clave-original')).status, 401);
    assert.equal((await login('clave-nueva-123')).status, 200);
    assert.equal((await ctx.request('POST', '/auth/refresh', { cookie: session.cookie })).status, 401);

    const other = await reset(olderToken, 'otra-clave-456');
    assert.equal(other.status, 400);
    assert.equal(other.body.message, INVALID_RESET_TOKEN);
  });

  it('rechaza un token reutilizado', async () => {
    await forgot('maria@example.com');
    await new Promise((resolve) => setImmediate(resolve));
    const token = ctx.mailer.lastToken();

    assert.equal((await reset(token, 'primera-clave-1')).status, 200);
    const second = await reset(token, 'segunda-clave-2');
    assert.equal(second.status, 400);
    assert.equal(second.body.message, INVALID_RESET_TOKEN);
    assert.equal((await login('primera-clave-1')).status, 200);
  });

  it('rechaza un token expirado (más de 30 minutos)', async () => {
    await forgot('maria@example.com');
    await new Promise((resolve) => setImmediate(resolve));
    const token = ctx.mailer.lastToken();

    const realNow = ctx.clock.now;
    ctx.clock.now = new Date(realNow.getTime() + RESET_TOKEN_TTL_MS + 1000);
    try {
      const response = await reset(token, 'clave-tardia-99');
      assert.equal(response.status, 400);
      assert.equal(response.body.message, INVALID_RESET_TOKEN);
    } finally {
      ctx.clock.now = realNow;
    }
  });

  it('rechaza tokens inventados y contraseñas nuevas cortas', async () => {
    assert.equal((await reset('token-inventado', 'clave-valida-1')).status, 400);
    const short = await reset('cualquier-token', 'corta');
    assert.equal(short.status, 400);
    assert.equal(short.body.errors[0].field, 'password');
  });
});

describe('Rate limit', () => {
  let ctx: TestContext;
  before(async () => {
    ctx = await startTestApp({ rateLimits: { loginMax: 2, forgotPasswordMax: 1, resetPasswordMax: 1 } });
  });
  after(() => ctx.close());

  it('limita los intentos de login', async () => {
    const attempt = () => ctx.login('x@example.com', 'nope-nope');
    assert.equal((await attempt()).status, 401);
    assert.equal((await attempt()).status, 401);
    const limited = await attempt();
    assert.equal(limited.status, 429);
    assert.ok(limited.body.message);
  });

  it('limita forgot-password y reset-password', async () => {
    const forgot = () => ctx.request('POST', '/auth/forgot-password', { body: { email: 'x@example.com' } });
    assert.equal((await forgot()).status, 202);
    assert.equal((await forgot()).status, 429);

    const nuevaClave = 'clave-valida-1';
    const reset = () => ctx.request('POST', '/auth/reset-password', { body: { token: 'x', password: nuevaClave } });
    assert.equal((await reset()).status, 400);
    assert.equal((await reset()).status, 429);
  });
});
