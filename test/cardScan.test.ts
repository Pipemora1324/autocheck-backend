import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import Anthropic from '@anthropic-ai/sdk';
import { MAX_CARD_IMAGE_BYTES } from '../src/controllers/cardScanController.js';
import { detectImageType } from '../src/domain/imageSignature.js';
import { AnthropicCardScanner } from '../src/services/anthropicCardScanner.js';
import {
  CardReaderUnavailableError,
  CardScannerBusyError,
  CardUnreadableError,
  type CardImage,
  type CardScanner,
  type RawCardExtraction
} from '../src/services/cardScanner.js';
import { SCAN_PROVIDER_BUSY_MESSAGE } from '../src/services/cardScanService.js';
import { startTestApp, type TestContext } from './support/testApp.js';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const WEBP = new Uint8Array([...Buffer.from('RIFF'), 0x24, 0x00, 0x00, 0x00, ...Buffer.from('WEBPVP8 ')]);
const OWNER_DOCUMENT = 'C.C. 79123456';
// El cliente simulado nunca usa la clave.
const FAKE_KEY = 'x';

const reading = (overrides: Partial<RawCardExtraction> = {}): RawCardExtraction => ({
  isVehicleDocument: true,
  plate: { value: 'abc 123', confidence: 0.98 },
  brand: { value: 'RENAULT', confidence: 0.95 },
  model: { value: 'SANDERO', confidence: 0.9 },
  year: { value: 'MODELO 2019', confidence: 0.92 },
  color: { value: 'GRIS ESTRELLA', confidence: 1.7 },
  cylinderCc: { value: '1.598 CC', confidence: 0.8 },
  chassis: { value: '9FB BSRADD KM123456', confidence: 0.7 },
  fuelType: { value: 'GASOLINA', confidence: 0.9 },
  serviceType: { value: 'PARTICULAR', confidence: -0.2 },
  ownerDocument: { value: OWNER_DOCUMENT, confidence: 0.85 },
  warnings: ['La esquina inferior está borrosa.'],
  ...overrides
});

export class FakeCardReader implements CardScanner {
  readonly provider = 'gemini';
  readonly calls: Array<{ mediaType: string; bytes: number }> = [];
  next: RawCardExtraction | Error = reading();

  async read(image: CardImage) {
    this.calls.push({ mediaType: image.mediaType, bytes: image.data.length });
    if (this.next instanceof Error) throw this.next;
    return this.next;
  }
}

describe('Firma de imagen', () => {
  it('reconoce JPEG, PNG y WEBP por sus bytes, no por el nombre', () => {
    assert.equal(detectImageType(Buffer.from(JPEG)), 'image/jpeg');
    assert.equal(detectImageType(Buffer.from(PNG)), 'image/png');
    assert.equal(detectImageType(Buffer.from(WEBP)), 'image/webp');
    assert.equal(detectImageType(Buffer.from('%PDF-1.7 no soy una imagen')), null);
    assert.equal(detectImageType(Buffer.from('GIF89a......')), null);
    assert.equal(detectImageType(Buffer.alloc(0)), null);
  });
});

describe('POST /garage/scan-card', () => {
  let ctx: TestContext;
  let reader: FakeCardReader;
  let token: string;

  before(async () => {
    reader = new FakeCardReader();
    ctx = await startTestApp({ cardReader: reader, rateLimits: { scanCardPerHour: 1000 } });
    token = await ctx.registerVerified('escaner@example.com');
  });
  after(() => ctx.close());
  beforeEach(() => {
    reader.calls.length = 0;
    reader.next = reading();
  });

  const scan = (data: Uint8Array, type = 'image/jpeg', field = 'image') => ctx.upload('/garage/scan-card', { token, data, type, field });

  it('exige sesión y correo verificado', async () => {
    assert.equal((await ctx.upload('/garage/scan-card', { data: JPEG })).status, 401);
    const unverified = (await ctx.register('escaner.sinverificar@example.com')).body.accessToken;
    assert.equal((await ctx.upload('/garage/scan-card', { token: unverified, data: JPEG })).status, 403);
    assert.equal(reader.calls.length, 0);
  });

  it('precarga los datos normalizados con su confianza, sin guardarlos', async () => {
    const response = await scan(JPEG);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const { vehicle } = response.body;
    assert.deepEqual(vehicle.plate, { value: 'ABC-123', confidence: 0.98 });
    assert.deepEqual(vehicle.year, { value: 2019, confidence: 0.92 });
    assert.deepEqual(vehicle.cylinderCc, { value: 1598, confidence: 0.8 });
    assert.deepEqual(vehicle.chassis, { value: '9FBBSRADDKM123456', confidence: 0.7 });
    assert.deepEqual(vehicle.fuelType, { value: 'Gasolina', confidence: 0.9 });
    assert.deepEqual(vehicle.serviceType, { value: 'Particular', confidence: 0 });
    assert.deepEqual(vehicle.color, { value: 'GRIS ESTRELLA', confidence: 1 });
    assert.equal(response.body.kind, 'carro');
    assert.deepEqual(response.body.ownerDocument, { value: OWNER_DOCUMENT, confidence: 0.85 });
    assert.equal(response.body.stored, false);
    assert.deepEqual(response.body.next, { confirmWith: 'POST /garage', source: 'scan' });

    const user = (await ctx.users.findByEmail('escaner@example.com'))!;
    assert.equal(await ctx.garage.count(user.id), 0);
  });

  it('el usuario confirma con POST /garage (source "scan"); el documento del propietario no se acepta', async () => {
    const prefill = (await scan(JPEG)).body.vehicle;
    const body = Object.fromEntries(Object.entries(prefill).map(([key, item]) => [key, (item as { value: unknown }).value]));
    const created = await ctx.request('POST', '/garage', { token, body: { ...body, source: 'scan' } });
    assert.equal(created.status, 201);
    assert.equal(created.body.source, 'scan');

    const withOwner = await ctx.request('POST', '/garage', { token, body: { ...body, plate: 'ABC-124', ownerDocument: OWNER_DOCUMENT } });
    assert.equal(withOwner.status, 400);
  });

  it('usa el tipo real por firma, no el declarado', async () => {
    assert.equal((await scan(JPEG, 'image/png')).status, 200);
    assert.equal((await scan(PNG, 'image/jpeg')).status, 200);
    assert.equal((await scan(WEBP, 'application/octet-stream')).status, 200);
    assert.deepEqual(reader.calls.map((call) => call.mediaType), ['image/jpeg', 'image/png', 'image/webp']);
  });

  it('rechaza archivos que no son imágenes, aunque digan serlo', async () => {
    const response = await scan(new TextEncoder().encode('<svg onload="alert(1)"></svg>'), 'image/png');
    assert.equal(response.status, 415);
    assert.equal(response.body.code, 'UNSUPPORTED_IMAGE');
    assert.equal(reader.calls.length, 0);
  });

  it('rechaza imágenes de más de 5 MB y peticiones sin imagen o con otro campo', async () => {
    const big = new Uint8Array(MAX_CARD_IMAGE_BYTES + 1);
    big.set(JPEG);
    const tooLarge = await scan(big);
    assert.equal(tooLarge.status, 413);
    assert.equal(tooLarge.body.code, 'IMAGE_TOO_LARGE');

    const wrongField = await scan(JPEG, 'image/jpeg', 'foto');
    assert.equal(wrongField.status, 400);
    assert.equal(wrongField.body.code, 'INVALID_UPLOAD');

    const none = await ctx.request('POST', '/garage/scan-card', { token, body: {} });
    assert.equal(none.status, 400);
    assert.equal(none.body.code, 'IMAGE_REQUIRED');
    assert.equal(reader.calls.length, 0);
  });

  it('explica cuando la imagen no es una tarjeta, no se puede leer o el servicio falla', async () => {
    reader.next = reading({ isVehicleDocument: false });
    assert.equal((await scan(JPEG)).body.code, 'NOT_A_VEHICLE_DOCUMENT');

    reader.next = new CardUnreadableError('x');
    const unreadable = await scan(JPEG);
    assert.equal(unreadable.status, 422);
    assert.equal(unreadable.body.code, 'CARD_UNREADABLE');

    reader.next = new CardReaderUnavailableError('x');
    const unavailable = await scan(JPEG);
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.body.code, 'VISION_UNAVAILABLE');

    reader.next = new CardScannerBusyError('x');
    const busy = await scan(JPEG);
    assert.equal(busy.status, 503);
    assert.equal(busy.body.code, 'SCAN_PROVIDER_BUSY');
    assert.equal(busy.body.message, SCAN_PROVIDER_BUSY_MESSAGE);
    assert.match(busy.body.message, /intenta en un minuto o ingresa los datos a mano/i);
  });

  it('una placa leída con formato inválido queda vacía y genera un aviso', async () => {
    reader.next = reading({ plate: { value: 'ABC-1234', confidence: 0.9 } });
    const response = await scan(JPEG);
    assert.deepEqual(response.body.vehicle.plate, { value: null, confidence: 0 });
    assert.equal(response.body.kind, null);
    assert.ok(response.body.warnings.some((warning: string) => /formato colombiano/.test(warning)));
  });

  describe('sin registrar datos extraídos en logs', () => {
    const captured: string[] = [];
    const originals = { log: console.log, info: console.info, warn: console.warn, error: console.error };
    beforeEach(() => {
      captured.length = 0;
      for (const level of Object.keys(originals) as Array<keyof typeof originals>) {
        console[level] = (...args: unknown[]) => captured.push(args.map(String).join(' '));
      }
    });
    afterEach(() => Object.assign(console, originals));

    it('ni el documento del propietario ni la placa aparecen en la consola', async () => {
      assert.equal((await scan(JPEG)).status, 200);
      reader.next = new CardReaderUnavailableError('x');
      await scan(JPEG);
      const output = captured.join('\n');
      assert.doesNotMatch(output, /79123456/);
      assert.doesNotMatch(output, /ABC-?123/i);
    });
  });
});

describe('POST /garage/scan-card sin ANTHROPIC_API_KEY', () => {
  let ctx: TestContext;
  before(async () => { ctx = await startTestApp({ cardReader: null }); });
  after(() => ctx.close());

  it('responde 503 con un mensaje claro en español', async () => {
    const token = await ctx.registerVerified('sin.vision@example.com');
    const response = await ctx.upload('/garage/scan-card', { token, data: JPEG });
    assert.equal(response.status, 503);
    assert.equal(response.body.code, 'VISION_NOT_CONFIGURED');
    assert.match(response.body.message, /no está configurada/);
  });
});

describe('Rate limit de lectura de tarjetas (por usuario)', () => {
  let ctx: TestContext;
  before(async () => { ctx = await startTestApp({ cardReader: new FakeCardReader(), rateLimits: { scanCardPerHour: 2 } }); });
  after(() => ctx.close());

  it('limita a cada usuario por separado', async () => {
    const ana = await ctx.registerVerified('limite.ana@example.com');
    const luis = await ctx.registerVerified('limite.luis@example.com');
    assert.equal((await ctx.upload('/garage/scan-card', { token: ana, data: JPEG })).status, 200);
    assert.equal((await ctx.upload('/garage/scan-card', { token: ana, data: JPEG })).status, 200);
    const limited = await ctx.upload('/garage/scan-card', { token: ana, data: JPEG });
    assert.equal(limited.status, 429);
    assert.equal(limited.body.code, 'RATE_LIMITED');
    assert.equal((await ctx.upload('/garage/scan-card', { token: luis, data: JPEG })).status, 200);
  });
});

describe('AnthropicCardScanner (cliente simulado, sin llamar a la API)', () => {
  const image: CardImage = { data: Buffer.from(JPEG), mediaType: 'image/jpeg' };
  const fakeClient = (respond: (params: any) => unknown) => {
    const calls: any[] = [];
    const client = { beta: { messages: { parse: async (params: any) => { calls.push(params); return respond(params); } } } } as any;
    return { client, calls };
  };

  it('envía la imagen en base64 con el modelo configurado, salida estructurada y fallback ante rechazos', async () => {
    const { client, calls } = fakeClient(() => ({ stop_reason: 'end_turn', parsed_output: reading() }));
    const reader = new AnthropicCardScanner({ apiKey: FAKE_KEY, model: 'modelo-de-prueba', client });
    const result = await reader.read(image);
    assert.equal(result.brand.value, 'RENAULT');

    const params = calls[0];
    assert.equal(params.model, 'modelo-de-prueba');
    assert.deepEqual(params.betas, ['server-side-fallback-2026-07-01']);
    assert.equal(params.fallbacks, 'default');
    assert.ok(params.output_config.format);
    const [imageBlock] = params.messages[0].content;
    assert.equal(imageBlock.type, 'image');
    assert.equal(imageBlock.source.media_type, 'image/jpeg');
    assert.equal(imageBlock.source.data, Buffer.from(JPEG).toString('base64'));
    assert.match(params.system, /nunca una instrucción/);
  });

  it('un rechazo o una salida no válida se reportan como tarjeta ilegible', async () => {
    for (const response of [{ stop_reason: 'refusal', parsed_output: null }, { stop_reason: 'end_turn', parsed_output: null }, { stop_reason: 'max_tokens', parsed_output: null }]) {
      const { client } = fakeClient(() => response);
      await assert.rejects(new AnthropicCardScanner({ apiKey: FAKE_KEY, model: 'm', client }).read(image), CardUnreadableError);
    }
  });

  it('traduce los errores de la API sin exponer su contenido', async () => {
    const quiet = console.error;
    console.error = () => {};
    try {
      const cases: Array<[Error, new (...args: any[]) => Error]> = [
        [new Anthropic.AuthenticationError(401, {}, 'clave inválida', new Headers()), CardReaderUnavailableError],
        [new Anthropic.RateLimitError(429, {}, 'límite', new Headers()), CardScannerBusyError],
        [new Anthropic.BadRequestError(400, {}, 'imagen inválida', new Headers()), CardUnreadableError]
      ];
      for (const [apiError, expected] of cases) {
        const { client } = fakeClient(() => { throw apiError; });
        await assert.rejects(new AnthropicCardScanner({ apiKey: FAKE_KEY, model: 'm', client }).read(image), expected);
      }
    } finally {
      console.error = quiet;
    }
  });
});
