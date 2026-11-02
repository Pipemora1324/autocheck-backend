import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { FORGOT_PASSWORD_MESSAGE } from '../src/controllers/authController.js';
import { BREVO_SEND_URL, BrevoEmailSender, EmailDeliveryError, type EmailSender } from '../src/services/emailSender.js';
import { createEmailSender, TemplatedMailer } from '../src/services/mailer.js';
import { startTestApp, type TestContext } from './support/testApp.js';

const BREVO_KEY = randomBytes(16).toString('hex');
const FROM = { email: 'no-reply@autocheck.example', name: 'AutoCheck-CO' };

/** fetch simulado: registra cada llamada y responde con el estado indicado. */
const fakeFetch = (status: number, body: unknown = { messageId: '<id@relay>' }) => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { impl, calls };
};

describe('BrevoEmailSender (fetch simulado)', () => {
  it('envía por la API v3 de Brevo con api-key y el cuerpo documentado', async () => {
    const { impl, calls } = fakeFetch(201);
    await new BrevoEmailSender(BREVO_KEY, FROM, impl).send({ to: 'ana@example.com', subject: 'Asunto', text: 'Texto', html: '<p>Texto</p>' });

    assert.equal(calls.length, 1);
    const { url, init } = calls[0]!;
    assert.equal(url, 'https://api.brevo.com/v3/smtp/email');
    assert.equal(url, BREVO_SEND_URL);
    assert.equal(init.method, 'POST');
    const headers = init.headers as Record<string, string>;
    assert.equal(headers['api-key'], BREVO_KEY);
    assert.equal(headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(String(init.body)), {
      sender: { email: 'no-reply@autocheck.example', name: 'AutoCheck-CO' },
      to: [{ email: 'ana@example.com' }],
      subject: 'Asunto',
      htmlContent: '<p>Texto</p>',
      textContent: 'Texto'
    });
    assert.ok(init.signal, 'debe tener tiempo límite');
  });

  it('si Brevo responde error, falla solo con el código de estado (sin cuerpo ni contenido)', async () => {
    const { impl } = fakeFetch(401, { code: 'unauthorized', message: 'Key not found' });
    await assert.rejects(
      new BrevoEmailSender(BREVO_KEY, FROM, impl).send({ to: 'ana@example.com', subject: 's', text: 't', html: 'h' }),
      (error: Error) => error instanceof EmailDeliveryError && error.message === 'Brevo respondió 401.'
    );
  });

  it('si la red falla, también lanza EmailDeliveryError', async () => {
    const failing = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
    await assert.rejects(new BrevoEmailSender(BREVO_KEY, FROM, failing).send({ to: 'a@b.co', subject: 's', text: 't', html: 'h' }), EmailDeliveryError);
  });
});

describe('createEmailSender', () => {
  it('elige el proveedor configurado y nunca la consola en producción', () => {
    assert.ok(createEmailSender({ isProduction: true, email: { provider: 'brevo', apiKey: BREVO_KEY, from: FROM } }) instanceof BrevoEmailSender);
    assert.throws(() => createEmailSender({ isProduction: true, email: { provider: 'console' } }), /no está permitido en producción/);
    assert.ok(createEmailSender({ isProduction: false, email: { provider: 'console' } }));
  });
});

describe('Plantillas en español', () => {
  it('verificación y recuperación llevan el enlace en texto y HTML escapado', async () => {
    const sent: Array<{ to: string; subject: string; text: string; html: string }> = [];
    const sender: EmailSender = { send: async (message) => { sent.push(message); } };
    const mailer = new TemplatedMailer(sender);
    const link = 'https://app.example/verify-email?token=abc&x=1';

    await mailer.sendEmailVerification('ana@example.com', link);
    await mailer.sendPasswordReset('ana@example.com', link.replace('verify-email', 'reset-password'));

    assert.equal(sent[0]!.subject, 'Confirma tu correo en AutoCheck-CO');
    assert.match(sent[0]!.text, /vence en 24 horas/);
    assert.ok(sent[0]!.text.includes(link));
    assert.ok(sent[0]!.html.includes('https://app.example/verify-email?token=abc&amp;x=1'));
    assert.equal(sent[1]!.subject, 'Restablece tu contraseña de AutoCheck-CO');
    assert.match(sent[1]!.text, /vence en 30 minutos/);
  });
});

describe('Endpoints con Brevo fallando', () => {
  let ctx: TestContext;
  const brevo = fakeFetch(500, { code: 'internal_error', message: 'boom' });
  const logs: string[] = [];
  const original = console.error;

  before(async () => {
    ctx = await startTestApp({ mailer: new TemplatedMailer(new BrevoEmailSender(BREVO_KEY, FROM, brevo.impl)) });
  });
  after(() => ctx.close());
  beforeEach(() => {
    logs.length = 0;
    console.error = (...args: unknown[]) => logs.push(args.map(String).join(' '));
  });
  afterEach(() => { console.error = original; });

  const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

  it('el registro y forgot-password responden normal, sin revelar el fallo al usuario', async () => {
    const registered = await ctx.register('brevo.falla@example.com');
    assert.equal(registered.status, 201);
    const forgot = await ctx.request('POST', '/auth/forgot-password', { body: { email: 'brevo.falla@example.com' } });
    assert.equal(forgot.status, 202);
    assert.equal(forgot.body.message, FORGOT_PASSWORD_MESSAGE);
    assert.doesNotMatch(JSON.stringify(forgot.body), /Brevo|500/);
    await flush();
    assert.equal(brevo.calls.length, 2);
  });

  it('registra el código de estado, pero ni tokens ni enlaces ni la clave', async () => {
    await ctx.request('POST', '/auth/resend-verification', { body: { email: 'brevo.falla@example.com' } });
    await flush();
    const output = logs.join('\n');
    assert.match(output, /Brevo respondió 500/);
    assert.doesNotMatch(output, /token=|verify-email|reset-password|http/);
    assert.ok(!output.includes(BREVO_KEY));
  });
});
