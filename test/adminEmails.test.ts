import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { DEFAULT_CLAVE, startTestApp, type TestContext } from './support/testApp.js';

const flushMail = () => new Promise((resolve) => setImmediate(resolve));

describe('ADMIN_EMAILS', () => {
  let ctx: TestContext;
  before(async () => { ctx = await startTestApp({ adminEmails: ['jefe@example.com', 'jefa.antigua@example.com'] }); });
  after(() => ctx.close());

  const role = async (email: string) => (await ctx.users.findByEmail(email))!.role;

  it('nunca da rol admin antes de verificar el correo', async () => {
    const registered = await ctx.register('JEFE@example.com');
    assert.equal(registered.body.user.role, 'user');
    const login = await ctx.login('jefe@example.com', DEFAULT_CLAVE);
    assert.equal(login.status, 200);
    assert.equal(login.body.user.role, 'user');
    assert.equal(await role('jefe@example.com'), 'user');
  });

  it('lo asigna al verificar el correo; el siguiente refresh ya lo refleja', async () => {
    const login = await ctx.login('jefe@example.com', DEFAULT_CLAVE);
    await flushMail();
    const verified = await ctx.request('POST', '/auth/verify-email', { body: { token: ctx.mailer.lastVerificationToken('jefe@example.com') } });
    assert.equal(verified.status, 200);
    assert.equal(await role('jefe@example.com'), 'admin');

    const refreshed = await ctx.request('POST', '/auth/refresh', { cookie: login.cookie });
    assert.equal(refreshed.body.user.role, 'admin');
    assert.equal(ctx.tokens.verifyAccessToken(refreshed.body.accessToken)?.role, 'admin');
  });

  it('lo asigna al iniciar sesión si el correo ya estaba verificado (por ejemplo, agregado a la lista después)', async () => {
    await ctx.register('jefa.antigua@example.com');
    const user = (await ctx.users.findByEmail('jefa.antigua@example.com'))!;
    // Simula una cuenta que ya se había verificado antes de estar en la lista.
    await ctx.users.markEmailVerified(user.id, new Date());
    assert.equal(await role('jefa.antigua@example.com'), 'user');

    const login = await ctx.login('jefa.antigua@example.com', DEFAULT_CLAVE);
    assert.equal(login.body.user.role, 'admin');
    assert.equal(await role('jefa.antigua@example.com'), 'admin');
  });

  it('los correos fuera de la lista siguen siendo user aunque estén verificados', async () => {
    await ctx.registerVerified('cualquiera@example.com');
    assert.equal((await ctx.login('cualquiera@example.com', DEFAULT_CLAVE)).body.user.role, 'user');
  });
});
