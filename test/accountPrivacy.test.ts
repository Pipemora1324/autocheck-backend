import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { WRONG_PASSWORD_CODE } from '../src/services/authService.js';
import { PRIVACY_POLICY_VERSION } from '../src/services/privacyPolicy.js';
import { DEFAULT_CLAVE, startTestApp, type TestContext } from './support/testApp.js';

describe('Consentimiento de tratamiento de datos', () => {
  let ctx: TestContext;
  before(async () => { ctx = await startTestApp(); });
  after(() => ctx.close());

  const registerWith = (body: Record<string, unknown>) => ctx.request('POST', '/auth/register', { body });

  it('exige acceptedTerms: true para registrarse', async () => {
    for (const acceptedTerms of [undefined, false, 'true', 1]) {
      const response = await registerWith({ email: 'sin-consentimiento@example.com', password: DEFAULT_CLAVE, acceptedTerms });
      assert.equal(response.status, 400, `acceptedTerms=${String(acceptedTerms)}`);
      assert.equal(response.body.errors[0].field, 'acceptedTerms');
    }
    assert.equal(await ctx.users.findByEmail('sin-consentimiento@example.com'), null);
  });

  it('guarda la fecha y la versión aceptadas, y /auth/me las devuelve', async () => {
    const response = await ctx.register('acepta@example.com');
    assert.equal(response.status, 201);

    const stored = (await ctx.users.findByEmail('acepta@example.com'))!;
    assert.equal(stored.termsAcceptedAt, ctx.clock.now.toISOString());
    assert.equal(stored.termsVersion, PRIVACY_POLICY_VERSION);

    const me = await ctx.request('GET', '/auth/me', { token: response.body.accessToken });
    assert.equal(me.body.user.termsAcceptedAt, ctx.clock.now.toISOString());
    assert.equal(me.body.user.termsVersion, PRIVACY_POLICY_VERSION);
  });
});

describe('DELETE /auth/me', () => {
  let ctx: TestContext;
  before(async () => { ctx = await startTestApp(); });
  after(() => ctx.close());

  it('exige la contraseña actual y responde 403 (no 401) si es incorrecta', async () => {
    const token = await ctx.registerVerified('borrar-mal@example.com');
    const otraClave = 'otra-clave-123';

    const missing = await ctx.request('DELETE', '/auth/me', { token, body: {} });
    assert.equal(missing.status, 400);
    assert.equal(missing.body.errors[0].field, 'password');

    const wrong = await ctx.request('DELETE', '/auth/me', { token, body: { password: otraClave } });
    assert.equal(wrong.status, 403);
    assert.equal(wrong.body.code, WRONG_PASSWORD_CODE);
    assert.ok(await ctx.users.findByEmail('borrar-mal@example.com'));
  });

  it('requiere sesión', async () => {
    assert.equal((await ctx.request('DELETE', '/auth/me', { body: { password: DEFAULT_CLAVE } })).status, 401);
  });

  it('borra la cuenta y sus sesiones, y limpia la cookie', async () => {
    const login = await (async () => {
      await ctx.registerVerified('borrar@example.com');
      return ctx.login('borrar@example.com', DEFAULT_CLAVE);
    })();
    const user = (await ctx.users.findByEmail('borrar@example.com'))!;
    assert.ok(ctx.refreshTokens.activeCount(user.id) > 0);

    const response = await ctx.request('DELETE', '/auth/me', { token: login.body.accessToken, cookie: login.cookie, body: { password: DEFAULT_CLAVE } });
    assert.equal(response.status, 204);
    assert.match(response.headers.getSetCookie().join(';'), /autocheck_refresh=;/);

    assert.equal(await ctx.users.findByEmail('borrar@example.com'), null);
    assert.equal(ctx.refreshTokens.activeCount(user.id), 0);
    assert.equal((await ctx.request('POST', '/auth/refresh', { cookie: login.cookie })).status, 401);
    assert.equal((await ctx.login('borrar@example.com', DEFAULT_CLAVE)).status, 401);
    // El access token emitido antes sigue siendo un JWT válido, pero ya no hay usuario detrás.
    assert.equal((await ctx.request('GET', '/auth/me', { token: login.body.accessToken })).status, 401);
    assert.equal((await ctx.request('GET', '/garage', { token: login.body.accessToken })).status, 401);
  });

  it('el correo queda libre para registrarse de nuevo', async () => {
    assert.equal((await ctx.register('borrar@example.com')).status, 201);
  });
});
