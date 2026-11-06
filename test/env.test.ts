import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';
import { EnvValidationError, loadConfig } from '../src/config/env.js';

// Generada en cada corrida para no dejar valores con forma de clave en el repositorio.
const BREVO_KEY = randomBytes(16).toString('hex');

const valid = {
  DATABASE_URL: 'postgres://localhost:5432/autocheck',
  JWT_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32)
};

/** Mínimo para arrancar en producción con la configuración de DEPLOY.md (correo por Brevo). */
const production = {
  ...valid,
  NODE_ENV: 'production',
  CORS_ORIGIN: 'https://a.vercel.app',
  APP_URL: 'https://a.vercel.app',
  BREVO_API_KEY: BREVO_KEY,
  MAIL_FROM: 'no-reply@autocheck.example'
};

describe('loadConfig', () => {
  it('aplica valores por defecto de desarrollo', () => {
    const config = loadConfig(valid);
    assert.equal(config.port, 3000);
    assert.equal(config.nodeEnv, 'development');
    assert.deepEqual(config.corsOrigins, ['http://localhost:4200']);
    assert.equal(config.appUrl, 'http://localhost:4200');
    assert.deepEqual(config.email, { provider: 'console' });
    assert.deepEqual(config.adminEmails, []);
    assert.deepEqual(config.scan, { provider: 'none' });
  });

  it('explica qué variables faltan', () => {
    assert.throws(() => loadConfig({}), (error: Error) => {
      assert.ok(error instanceof EnvValidationError);
      for (const name of ['DATABASE_URL', 'JWT_SECRET', 'JWT_REFRESH_SECRET']) assert.match(error.message, new RegExp(name));
      return true;
    });
  });

  it('exige secretos largos y distintos', () => {
    assert.throws(() => loadConfig({ ...valid, JWT_SECRET: 'corto' }), /JWT_SECRET/);
    assert.throws(() => loadConfig({ ...valid, JWT_REFRESH_SECRET: valid.JWT_SECRET }), /JWT_REFRESH_SECRET: Debe ser distinto/);
  });

  it('en producción exige CORS_ORIGIN, APP_URL y el correo por Brevo, y nada de SMTP', () => {
    assert.throws(() => loadConfig({ ...valid, NODE_ENV: 'production' }), (error: Error) => {
      for (const name of ['CORS_ORIGIN', 'APP_URL', 'BREVO_API_KEY', 'MAIL_FROM']) assert.match(error.message, new RegExp(name));
      assert.doesNotMatch(error.message, /SMTP_|ANTHROPIC|ADMIN_EMAILS/);
      return true;
    });

    const config = loadConfig({ ...production, CORS_ORIGIN: 'https://a.vercel.app, https://b.com', APP_URL: 'https://a.vercel.app/' });
    assert.deepEqual(config.corsOrigins, ['https://a.vercel.app', 'https://b.com']);
    assert.equal(config.appUrl, 'https://a.vercel.app');
    assert.deepEqual(config.email, { provider: 'brevo', apiKey: BREVO_KEY, from: { email: 'no-reply@autocheck.example', name: 'AutoCheck-CO' } });
  });

  it('arranca con las variables opcionales vacías, como las deja Render', () => {
    const config = loadConfig({ ...production, SCAN_PROVIDER: 'gemini', GEMINI_API_KEY: '', ANTHROPIC_API_KEY: '', ADMIN_EMAILS: '', SMTP_HOST: '' });
    assert.deepEqual(config.scan, { provider: 'none', missingKeyFor: 'gemini' });
    assert.deepEqual(config.adminEmails, []);
  });

  it('correo: valida cada proveedor por separado', () => {
    assert.throws(() => loadConfig({ ...production, BREVO_API_KEY: '' }), /BREVO_API_KEY: Es obligatoria/);
    assert.throws(() => loadConfig({ ...production, MAIL_FROM: 'AutoCheck <no-reply@autocheck.example>' }), /MAIL_FROM: Debe ser solo el correo/);
    assert.throws(() => loadConfig({ ...production, EMAIL_PROVIDER: 'console' }), /EMAIL_PROVIDER: console no envía/);
    assert.throws(() => loadConfig({ ...valid, EMAIL_PROVIDER: 'smtp', MAIL_FROM: 'a@b.co' }), /SMTP_HOST[\s\S]*SMTP_USER[\s\S]*SMTP_PASS/);
    assert.throws(() => loadConfig({ ...valid, EMAIL_PROVIDER: 'mailgun' }), /EMAIL_PROVIDER/);

    const smtp = loadConfig({ ...valid, EMAIL_PROVIDER: 'SMTP', SMTP_HOST: 'smtp.example.com', SMTP_PORT: '465', SMTP_USER: 'u', SMTP_PASS: 'p', MAIL_FROM: 'a@b.co', MAIL_FROM_NAME: 'Taller' });
    assert.equal(smtp.email.provider, 'smtp');
    assert.deepEqual(smtp.email.provider === 'smtp' && { port: smtp.email.port, from: smtp.email.from }, { port: 465, from: { email: 'a@b.co', name: 'Taller' } });
  });

  it('ADMIN_EMAILS: lista normalizada y validada', () => {
    assert.deepEqual(loadConfig({ ...valid, ADMIN_EMAILS: ' Ana@Example.com, ,luis@example.com ' }).adminEmails, ['ana@example.com', 'luis@example.com']);
    assert.throws(() => loadConfig({ ...valid, ADMIN_EMAILS: 'ana@example.com, no-es-correo' }), /ADMIN_EMAILS: Correo inválido "no-es-correo"/);
  });

  it('modelos de lectura: claude-sonnet-5-5 y gemini-3.5-flash-lite por defecto, y configurables', () => {
    const key = randomBytes(8).toString('hex');
    const model = (env: Record<string, string>) => {
      const { scan } = loadConfig({ ...valid, ...env });
      return scan.provider === 'none' ? null : scan.model;
    };
    assert.equal(model({ SCAN_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: key }), 'claude-sonnet-5-5');
    assert.equal(model({ SCAN_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: key, ANTHROPIC_MODEL: 'claude-opus-5-5' }), 'claude-opus-5-5');
    assert.equal(model({ SCAN_PROVIDER: 'gemini', GEMINI_API_KEY: key }), 'gemini-3.5-flash-lite');
    assert.equal(model({ SCAN_PROVIDER: 'gemini', GEMINI_API_KEY: key, GEMINI_MODEL: 'gemini-3.8-flash' }), 'gemini-3.8-flash');
  });

  it('cookie y proxy: valores por defecto por entorno', () => {
    const dev = loadConfig(valid);
    assert.deepEqual(dev.cookie, { path: '/auth', sameSite: 'lax', secure: false });
    assert.equal(dev.trustProxy, 0);

    const prod = loadConfig(production);
    assert.deepEqual(prod.cookie, { path: '/auth', sameSite: 'strict', secure: true });
    assert.equal(prod.trustProxy, 1);
  });

  it('cookie y proxy: configuración para Vercel + Render', () => {
    const config = loadConfig({ ...production, COOKIE_PATH: '/api/auth', COOKIE_SAMESITE: 'Lax', TRUST_PROXY: '2' });
    assert.deepEqual(config.cookie, { path: '/api/auth', sameSite: 'lax', secure: true });
    assert.equal(config.trustProxy, 2);
  });

  it('rechaza configuraciones inseguras o inválidas de cookie, proxy y CORS', () => {
    assert.throws(() => loadConfig({ ...valid, COOKIE_SAMESITE: 'none' }), /COOKIE_SAMESITE: none requiere/);
    assert.throws(() => loadConfig({ ...valid, COOKIE_SAMESITE: 'abierta' }), /COOKIE_SAMESITE/);
    assert.throws(() => loadConfig({ ...valid, COOKIE_PATH: 'api/auth' }), /COOKIE_PATH/);
    assert.throws(() => loadConfig({ ...valid, TRUST_PROXY: '-1' }), /TRUST_PROXY/);
    assert.throws(() => loadConfig({ ...valid, CORS_ORIGIN: '*' }), /CORS_ORIGIN: Origen inválido/);
    assert.throws(() => loadConfig({ ...valid, CORS_ORIGIN: 'https://a.vercel.app/' }), /CORS_ORIGIN/);
  });
});
