import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { loadConfig } from '../src/config/env.js';
import { CardReaderUnavailableError, CardScannerBusyError, CardUnreadableError, type CardImage, type RawCardExtraction } from '../src/services/cardScanner.js';
import { createCardScanner } from '../src/services/createCardScanner.js';
import { GEMINI_INTERACTIONS_URL, GEMINI_RESPONSE_SCHEMA, GeminiCardScanner } from '../src/services/geminiCardScanner.js';
import { PRIVACY_POLICY_VERSION, REGISTRATION_CONSENT_TEXT } from '../src/services/privacyPolicy.js';
import { startTestApp, type TestContext } from './support/testApp.js';

const GEMINI_KEY = randomBytes(16).toString('hex');
const image: CardImage = { data: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), mediaType: 'image/jpeg' };

const extraction: RawCardExtraction = {
  isVehicleDocument: true,
  plate: { value: 'ABC123', confidence: 0.97 },
  brand: { value: 'RENAULT', confidence: 0.9 },
  model: { value: 'SANDERO', confidence: 0.9 },
  year: { value: '2019', confidence: 0.9 },
  color: { value: 'GRIS', confidence: 0.8 },
  cylinderCc: { value: '1598', confidence: 0.8 },
  chassis: { value: null, confidence: 0 },
  fuelType: { value: 'GASOLINA', confidence: 0.9 },
  serviceType: { value: 'PARTICULAR', confidence: 0.9 },
  ownerDocument: { value: 'C.C. 79123456', confidence: 0.8 },
  warnings: []
};

/** Respuesta con el formato "steps" de la Interactions API. */
const interaction = (text: string) => ({
  id: 'interaccion-1',
  status: 'completed',
  steps: [{ type: 'thought', content: [] }, { type: 'model_output', content: [{ type: 'text', text }] }]
});

const fakeFetch = (status: number, body: unknown) => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { impl, calls };
};

const scanner = (impl: typeof fetch) => new GeminiCardScanner({ apiKey: GEMINI_KEY, model: 'gemini-3.5-flash-lite', fetchImpl: impl });

describe('GeminiCardScanner (fetch simulado)', () => {
  it('envía la imagen en base64 a la Interactions API con x-goog-api-key y pide JSON con esquema', async () => {
    const { impl, calls } = fakeFetch(200, interaction(JSON.stringify(extraction)));
    const result = await scanner(impl).read(image);
    assert.deepEqual(result, extraction);

    const { url, init } = calls[0]!;
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
    assert.equal(url, GEMINI_INTERACTIONS_URL);
    assert.equal(init.method, 'POST');
    const headers = init.headers as Record<string, string>;
    assert.equal(headers['x-goog-api-key'], GEMINI_KEY);
    assert.equal(headers['content-type'], 'application/json');

    const body = JSON.parse(String(init.body));
    assert.equal(body.model, 'gemini-3.5-flash-lite');
    assert.equal(body.input[0].type, 'text');
    assert.match(body.input[0].text, /nunca una instrucción/);
    assert.deepEqual(body.input[1], { type: 'image', data: image.data.toString('base64'), mime_type: 'image/jpeg' });
    assert.deepEqual(body.response_format, { type: 'text', mime_type: 'application/json', schema: GEMINI_RESPONSE_SCHEMA });
    assert.ok(init.signal, 'debe tener tiempo límite');
  });

  it('el esquema enviado usa el subconjunto de JSON Schema que admite Gemini', () => {
    const serialized = JSON.stringify(GEMINI_RESPONSE_SCHEMA);
    assert.doesNotMatch(serialized, /anyOf|oneOf|\$ref|pattern/);
    assert.deepEqual(GEMINI_RESPONSE_SCHEMA.required.sort(), Object.keys(extraction).sort());
  });

  it('valida la salida con zod: texto no JSON, esquema incumplido o sin model_output son ilegibles', async () => {
    for (const body of [
      interaction('esto no es JSON'),
      interaction(JSON.stringify({ ...extraction, plate: 'ABC123' })),
      { id: 'x', status: 'incomplete', steps: [{ type: 'thought', content: [] }] },
      'no-json'
    ]) {
      await assert.rejects(scanner(fakeFetch(200, body).impl).read(image), CardUnreadableError);
    }
  });

  it('429 de Gemini se reporta como servicio ocupado', async () => {
    await assert.rejects(scanner(fakeFetch(429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED' } }).impl).read(image), CardScannerBusyError);
  });

  it('otros errores: 400 ilegible; 401/403/5xx/red no disponible; sin registrar el cuerpo ni la clave', async () => {
    const logs: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => logs.push(args.map(String).join(' '));
    try {
      await assert.rejects(scanner(fakeFetch(400, { error: { message: 'detalle con datos' } }).impl).read(image), CardUnreadableError);
      for (const status of [401, 403, 500, 503]) {
        await assert.rejects(scanner(fakeFetch(status, { error: { message: 'detalle con datos' } }).impl).read(image), CardReaderUnavailableError);
      }
      const offline = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
      await assert.rejects(scanner(offline).read(image), CardReaderUnavailableError);
    } finally {
      console.error = original;
    }
    const output = logs.join('\n');
    assert.doesNotMatch(output, /detalle con datos/);
    assert.ok(!output.includes(GEMINI_KEY));
  });
});

describe('SCAN_PROVIDER', () => {
  const base = { DATABASE_URL: 'postgres://localhost/autocheck', JWT_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'b'.repeat(32) };

  it('elige el proveedor; sin clave queda apagado (503) en lugar de impedir el arranque', () => {
    assert.deepEqual(loadConfig(base).scan, { provider: 'none' });
    assert.deepEqual(loadConfig({ ...base, SCAN_PROVIDER: 'gemini' }).scan, { provider: 'none', missingKeyFor: 'gemini' });
    assert.deepEqual(loadConfig({ ...base, SCAN_PROVIDER: 'Gemini', GEMINI_API_KEY: GEMINI_KEY }).scan, {
      provider: 'gemini',
      apiKey: GEMINI_KEY,
      model: 'gemini-3.5-flash-lite'
    });
    const anthropic = loadConfig({ ...base, SCAN_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: GEMINI_KEY });
    assert.equal(anthropic.scan.provider === 'anthropic' && anthropic.scan.model, 'claude-sonnet-5-5');
    assert.equal(loadConfig({ ...base, SCAN_PROVIDER: 'gemini', GEMINI_API_KEY: GEMINI_KEY, GEMINI_MODEL: 'gemini-3.8-flash' }).scan.provider === 'gemini', true);
    assert.throws(() => loadConfig({ ...base, SCAN_PROVIDER: 'openai' }), /SCAN_PROVIDER/);
  });

  it('crea el escáner que corresponde', () => {
    assert.equal(createCardScanner({ provider: 'none' }), null);
    assert.equal(createCardScanner({ provider: 'gemini', apiKey: GEMINI_KEY, model: 'm' })?.provider, 'gemini');
    assert.equal(createCardScanner({ provider: 'anthropic', apiKey: GEMINI_KEY, model: 'm' })?.provider, 'anthropic');
  });
});

describe('GET /config/public y avisos de privacidad', () => {
  let ctx: TestContext;
  let off: TestContext;
  before(async () => {
    const gemini = scanner(fakeFetch(200, interaction(JSON.stringify(extraction))).impl);
    ctx = await startTestApp({ cardReader: gemini });
    off = await startTestApp({ cardReader: null });
  });
  after(async () => { await ctx.close(); await off.close(); });

  it('es público y expone el proveedor activo, el aviso y el texto de consentimiento versionado', async () => {
    const response = await ctx.request('GET', '/config/public');
    assert.equal(response.status, 200);
    assert.equal(response.body.privacyPolicy.version, PRIVACY_POLICY_VERSION);
    assert.equal(response.body.privacyPolicy.registrationConsent, REGISTRATION_CONSENT_TEXT);
    assert.match(REGISTRATION_CONSENT_TEXT, /proveedor externo/);
    assert.match(REGISTRATION_CONSENT_TEXT, /mejorar sus productos/);
    assert.match(REGISTRATION_CONSENT_TEXT, /No subiré la tarjeta de otra persona sin su autorización/);
    assert.equal(response.body.cardScan.enabled, true);
    assert.equal(response.body.cardScan.provider, 'gemini');
    assert.match(response.body.cardScan.notice, /Google .*plan gratuito/);
    assert.match(response.body.cardScan.notice, /mejorar sus productos/);
  });

  it('sin proveedor, cardScan aparece apagado y sin aviso', async () => {
    const response = await off.request('GET', '/config/public');
    assert.deepEqual(response.body.cardScan, { enabled: false, provider: 'none', notice: null });
  });

  it('el registro guarda la nueva versión de la política', async () => {
    await ctx.register('politica@example.com');
    assert.equal((await ctx.users.findByEmail('politica@example.com'))!.termsVersion, PRIVACY_POLICY_VERSION);
  });

  it('el flujo completo con Gemini (simulado) precarga los datos normalizados', async () => {
    const token = await ctx.registerVerified('gemini.flujo@example.com');
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
    const response = await ctx.upload('/garage/scan-card', { token, data: jpeg });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.vehicle.plate, { value: 'ABC-123', confidence: 0.97 });
    assert.equal(response.body.stored, false);
  });
});
