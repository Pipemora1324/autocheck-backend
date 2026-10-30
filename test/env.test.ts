import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EnvValidationError, loadConfig } from '../src/config/env.js';

const valid = {
  DATABASE_URL: 'postgres://localhost:5432/autocheck',
  JWT_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32)
};

describe('loadConfig', () => {
  it('aplica valores por defecto de desarrollo', () => {
    const config = loadConfig(valid);
    assert.equal(config.port, 3000);
    assert.equal(config.nodeEnv, 'development');
    assert.deepEqual(config.corsOrigins, ['http://localhost:4200']);
    assert.equal(config.appUrl, 'http://localhost:4200');
    assert.equal(config.smtp, null);
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

  it('exige CORS_ORIGIN y APP_URL en producción', () => {
    assert.throws(() => loadConfig({ ...valid, NODE_ENV: 'production' }), /CORS_ORIGIN[\s\S]*APP_URL/);
    const config = loadConfig({ ...valid, NODE_ENV: 'production', CORS_ORIGIN: 'https://a.vercel.app, https://b.com', APP_URL: 'https://a.vercel.app/' });
    assert.deepEqual(config.corsOrigins, ['https://a.vercel.app', 'https://b.com']);
    assert.equal(config.appUrl, 'https://a.vercel.app');
  });

  it('pide completar SMTP si está a medias', () => {
    assert.throws(() => loadConfig({ ...valid, SMTP_HOST: 'smtp.example.com' }), /SMTP_USER[\s\S]*SMTP_PASS[\s\S]*MAIL_FROM/);
    const config = loadConfig({ ...valid, SMTP_HOST: 'smtp.example.com', SMTP_PORT: '465', SMTP_USER: 'u', SMTP_PASS: 'p', MAIL_FROM: 'AutoCheck <no-reply@example.com>' });
    assert.equal(config.smtp?.port, 465);
  });
});
