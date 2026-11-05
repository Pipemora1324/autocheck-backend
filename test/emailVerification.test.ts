import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { RESEND_VERIFICATION_MESSAGE } from '../src/controllers/authController.js';
import { EMAIL_NOT_VERIFIED } from '../src/middleware/auth.js';
import { hashOneTimeToken, INVALID_VERIFICATION_TOKEN, VERIFICATION_TOKEN_TTL_MS } from '../src/services/authService.js';
import { startTestApp, type TestContext } from './support/testApp.js';

const flushMail = () => new Promise((resolve) => setImmediate(resolve));

describe('Verificación de correo', () => {
  let ctx: TestContext;
  before(async () => { ctx = await startTestApp(); });
  after(() => ctx.close());

  const verify = (token: string) => ctx.request('POST', '/auth/verify-email', { body: { token } });
  const resend = (email: string) => ctx.request('POST', '/auth/resend-verification', { body: { email } });

  it('al registrarse se envía un enlace APP_URL/verify-email y solo se guarda el hash del token', async () => {
    const response = await ctx.register('nueva@example.com');
    assert.equal(response.status, 201);
    assert.equal(response.body.user.emailVerified, false);
    await flushMail();

    const mail = ctx.mailer.verifications.at(-1)!;
    assert.equal(mail.to, 'nueva@example.com');
    assert.match(mail.verifyUrl, /^http:\/\/localhost:4200\/verify-email\?token=[\w-]{40,}$/);

    const token = ctx.mailer.lastVerificationToken('nueva@example.com');
    const stored = ctx.verificationTokens.tokens.at(-1)!;
    assert.equal(stored.tokenHash, hashOneTimeToken(token));
    assert.ok(!ctx.verificationTokens.tokens.some((row) => row.tokenHash === token));
    assert.equal(stored.expiresAt.getTime() - ctx.clock.now.getTime(), VERIFICATION_TOKEN_TTL_MS);
  });

  it('sin verificar se puede iniciar sesión, pero /garage responde 403 EMAIL_NOT_VERIFIED', async () => {
    await ctx.register('sinverificar@example.com');
    const login = await ctx.login('sinverificar@example.com', 'contraseña-segura');
    assert.equal(login.status, 200);
    assert.equal(login.body.user.emailVerified, false);

    const me = await ctx.request('GET', '/auth/me', { token: login.body.accessToken });
    assert.equal(me.status, 200);
    assert.equal(me.body.user.emailVerified, false);

    const vehicles = await ctx.request('GET', '/garage', { token: login.body.accessToken });
    assert.equal(vehicles.status, 403);
    assert.equal(vehicles.body.code, EMAIL_NOT_VERIFIED);
  });

  it('al verificar, el mismo access token ya puede usar /garage y /auth/me lo refleja', async () => {
    const registered = await ctx.register('verifica@example.com');
    const accessToken = registered.body.accessToken;
    await flushMail();

    const response = await verify(ctx.mailer.lastVerificationToken('verifica@example.com'));
    assert.equal(response.status, 200);
    assert.equal(response.body.emailVerified, true);

    assert.equal((await ctx.request('GET', '/garage', { token: accessToken })).status, 200);
    assert.equal((await ctx.request('GET', '/auth/me', { token: accessToken })).body.user.emailVerified, true);
    assert.equal((await ctx.login('verifica@example.com', 'contraseña-segura')).body.user.emailVerified, true);
  });

  it('rechaza un token reutilizado', async () => {
    await ctx.register('reuso@example.com');
    await flushMail();
    const token = ctx.mailer.lastVerificationToken('reuso@example.com');
    assert.equal((await verify(token)).status, 200);

    const second = await verify(token);
    assert.equal(second.status, 400);
    assert.equal(second.body.message, INVALID_VERIFICATION_TOKEN);
  });

  it('rechaza un token expirado (más de 24 horas)', async () => {
    await ctx.register('expira@example.com');
    await flushMail();
    const token = ctx.mailer.lastVerificationToken('expira@example.com');

    const realNow = ctx.clock.now;
    ctx.clock.now = new Date(realNow.getTime() + VERIFICATION_TOKEN_TTL_MS + 1000);
    try {
      const response = await verify(token);
      assert.equal(response.status, 400);
      assert.equal(response.body.message, INVALID_VERIFICATION_TOKEN);
    } finally {
      ctx.clock.now = realNow;
    }
    const user = await ctx.users.findByEmail('expira@example.com');
    assert.equal(user!.emailVerifiedAt, null);
  });

  it('rechaza tokens inventados o vacíos', async () => {
    assert.equal((await verify('inventado')).status, 400);
    const empty = await verify('');
    assert.equal(empty.status, 400);
    assert.equal(empty.body.errors[0].field, 'token');
  });

  it('el reenvío responde siempre lo mismo y solo envía a cuentas sin verificar', async () => {
    await ctx.register('reenvio@example.com');
    await flushMail();
    const firstToken = ctx.mailer.lastVerificationToken('reenvio@example.com');
    const before = ctx.mailer.verifications.length;

    const existing = await resend('REENVIO@example.com');
    const missing = await resend('no-existe@example.com');
    assert.equal(existing.status, 202);
    assert.equal(missing.status, 202);
    assert.deepEqual(existing.body, missing.body);
    assert.equal(existing.body.message, RESEND_VERIFICATION_MESSAGE);
    await flushMail();
    assert.equal(ctx.mailer.verifications.length, before + 1);

    // El enlace nuevo funciona y deja sin efecto el anterior.
    const newToken = ctx.mailer.lastVerificationToken('reenvio@example.com');
    assert.notEqual(newToken, firstToken);
    assert.equal((await verify(newToken)).status, 200);
    assert.equal((await verify(firstToken)).status, 400);

    // Ya verificada: responde igual, pero no envía nada.
    const afterVerified = ctx.mailer.verifications.length;
    const again = await resend('reenvio@example.com');
    assert.deepEqual(again.body, missing.body);
    await flushMail();
    assert.equal(ctx.mailer.verifications.length, afterVerified);
  });
});

describe('Rate limit de verificación', () => {
  let ctx: TestContext;
  before(async () => { ctx = await startTestApp({ rateLimits: { resendVerificationEmailMax: 2, verifyEmailMax: 2 } }); });
  after(() => ctx.close());

  it('limita el reenvío por correo y los intentos de verificación', async () => {
    const resend = () => ctx.request('POST', '/auth/resend-verification', { body: { email: 'limite@example.com' } });
    assert.equal((await resend()).status, 202);
    assert.equal((await resend()).status, 202);
    assert.equal((await resend()).status, 429);

    const verify = () => ctx.request('POST', '/auth/verify-email', { body: { token: 'x' } });
    assert.equal((await verify()).status, 400);
    assert.equal((await verify()).status, 400);
    assert.equal((await verify()).status, 429);
  });
});
