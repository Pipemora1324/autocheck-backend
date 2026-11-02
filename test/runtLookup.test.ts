import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { loadConfig } from '../src/config/env.js';
import { createVehicleLookupProvider } from '../src/providers/createVehicleLookupProvider.js';
import type { VehicleLookupInput, VehicleLookupProvider, VehicleLookupResult } from '../src/providers/VehicleLookupProvider.js';
import { VerifikVehicleLookupProvider } from '../src/providers/verifikProvider.js';
import { startTestApp, type TestContext } from './support/testApp.js';

const DOCUMENT_NUMBER = '79123456';

class SimulatedProvider implements VehicleLookupProvider {
  readonly name = 'simulado';
  readonly enabled = true;
  readonly calls: VehicleLookupInput[] = [];
  next: VehicleLookupResult = {
    status: 'found',
    provider: 'simulado',
    queriedAt: '2026-11-02T17:00:00.000Z',
    data: {
      brand: 'RENAULT',
      model: 'SANDERO',
      year: 2019,
      color: null,
      cylinderCc: 1598,
      chassis: '9FBBSRADDKM123456',
      fuelType: 'Gasolina',
      serviceType: 'Particular',
      soatExpiresOn: '2027-04-30',
      rtmExpiresOn: '2027-02-28',
      runtStatus: 'ACTIVO'
    }
  };

  async lookupByPlate(input: VehicleLookupInput) {
    this.calls.push(input);
    return this.next;
  }
}

const consentBody = (ownerDocument: unknown = { type: 'CC', number: DOCUMENT_NUMBER }) => ({ consent: true, ownerDocument });

describe('Proveedor RUNT desactivado (RUNT_PROVIDER=none)', () => {
  let ctx: TestContext;
  let token: string;
  before(async () => {
    ctx = await startTestApp();
    token = await ctx.registerVerified('runt.none@example.com');
    await ctx.request('POST', '/garage', { token, body: { plate: 'ABC-123', brand: 'Renault', model: 'Sandero' } });
  });
  after(() => ctx.close());

  it('capabilities informa qué está activo', async () => {
    const response = await ctx.request('GET', '/garage/capabilities', { token });
    assert.deepEqual(response.body, { cardScan: { enabled: false, provider: 'none', notice: null }, runtLookup: { enabled: false, provider: 'none' } });
  });

  it('refresh-from-runt responde 503 y el garaje manual sigue funcionando', async () => {
    const response = await ctx.request('POST', '/garage/ABC-123/refresh-from-runt', { token, body: consentBody() });
    assert.equal(response.status, 503);
    assert.equal(response.body.code, 'RUNT_PROVIDER_DISABLED');
    assert.equal((await ctx.request('GET', '/garage/ABC-123', { token })).body.source, 'manual');
  });
});

describe('POST /garage/:plate/refresh-from-runt con proveedor activo', () => {
  let ctx: TestContext;
  let provider: SimulatedProvider;
  let token: string;

  before(async () => {
    provider = new SimulatedProvider();
    ctx = await startTestApp({ lookupProvider: provider });
    ctx.clock.now = new Date('2026-11-02T17:00:00Z');
    token = await ctx.registerVerified('runt.activo@example.com');
  });
  after(() => ctx.close());
  beforeEach(async () => {
    provider.calls.length = 0;
    await ctx.request('DELETE', '/garage/ABC-123', { token });
    await ctx.request('POST', '/garage', { token, body: { plate: 'ABC-123', brand: 'Renault', model: 'Sandero', color: 'Gris' } });
  });

  const refresh = (body: unknown, plate = 'ABC-123') => ctx.request('POST', `/garage/${plate}/refresh-from-runt`, { token, body });

  it('exige consentimiento explícito en el cuerpo', async () => {
    for (const body of [{ ownerDocument: { type: 'CC', number: DOCUMENT_NUMBER } }, { ...consentBody(), consent: false }, { ...consentBody(), consent: 'true' }]) {
      const response = await refresh(body);
      assert.equal(response.status, 400);
      assert.equal(response.body.errors[0].field, 'consent');
    }
    assert.equal(provider.calls.length, 0);
  });

  it('valida el documento del propietario y no lo repite en el error', async () => {
    const response = await refresh(consentBody({ type: 'XX', number: '12ab' }));
    assert.equal(response.status, 400);
    assert.doesNotMatch(JSON.stringify(response.body), /12ab/);
    assert.equal(provider.calls.length, 0);
  });

  it('acepta el documento como texto, igual que lo devuelve el escaneo', async () => {
    assert.equal((await refresh(consentBody('C.C. 79.123.456'))).status, 200);
    assert.deepEqual(provider.calls[0], { plate: 'ABC-123', ownerDocument: { type: 'CC', number: DOCUMENT_NUMBER } });
  });

  it('actualiza solo los datos que devolvió el proveedor y marca la fuente como runt', async () => {
    const response = await refresh(consentBody());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const { vehicle, lookup } = response.body;
    assert.equal(vehicle.source, 'runt');
    assert.equal(vehicle.brand, 'RENAULT');
    assert.equal(vehicle.color, 'Gris');
    assert.equal(vehicle.soat.status, 'Vigente');
    assert.equal(vehicle.runtStatus, 'ACTIVO');
    assert.equal(lookup.provider, 'simulado');
    assert.ok(!lookup.fieldsUpdated.includes('color'));
    assert.ok(lookup.fieldsUpdated.includes('soatExpiresOn'));
  });

  it('el documento del propietario no se guarda', async () => {
    await refresh(consentBody());
    assert.doesNotMatch(JSON.stringify(ctx.garage.vehicles), new RegExp(DOCUMENT_NUMBER));
    assert.doesNotMatch(JSON.stringify((await ctx.request('GET', '/garage', { token })).body), new RegExp(DOCUMENT_NUMBER));
  });

  it('solo para vehículos del propio garaje', async () => {
    const response = await refresh(consentBody(), 'XYZ-999');
    assert.equal(response.status, 404);
    assert.equal(provider.calls.length, 0);
  });

  it('si el proveedor no encuentra el vehículo, responde 404 y no modifica nada', async () => {
    provider.next = { status: 'not_found', provider: 'simulado' };
    const response = await refresh(consentBody());
    assert.equal(response.status, 404);
    assert.equal(response.body.code, 'RUNT_NOT_FOUND');
    assert.equal((await ctx.request('GET', '/garage/ABC-123', { token })).body.source, 'manual');
  });

  it('si el proveedor falla, responde 503', async () => {
    provider.next = { status: 'unavailable', provider: 'simulado', reason: 'error' };
    const response = await refresh(consentBody());
    assert.equal(response.status, 503);
    assert.equal(response.body.code, 'RUNT_UNAVAILABLE');
  });
});

describe('Rate limit de consultas RUNT (por usuario)', () => {
  let ctx: TestContext;
  before(async () => { ctx = await startTestApp({ lookupProvider: new SimulatedProvider(), rateLimits: { runtLookupPerHour: 2 } }); });
  after(() => ctx.close());

  it('limita las consultas por hora', async () => {
    const token = await ctx.registerVerified('runt.limite@example.com');
    await ctx.request('POST', '/garage', { token, body: { plate: 'ABC-123', brand: 'Renault', model: 'Sandero' } });
    const refresh = () => ctx.request('POST', '/garage/ABC-123/refresh-from-runt', { token, body: consentBody() });
    assert.equal((await refresh()).status, 200);
    assert.equal((await refresh()).status, 200);
    assert.equal((await refresh()).status, 429);
  });
});

describe('Adaptador Verifik (esqueleto)', () => {
  it('se selecciona con RUNT_PROVIDER=verifik y exige VERIFIK_API_KEY', () => {
    const base = { DATABASE_URL: 'postgres://localhost/autocheck', JWT_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'b'.repeat(32) };
    assert.deepEqual(loadConfig(base).runtProvider, { name: 'none' });
    assert.throws(() => loadConfig({ ...base, RUNT_PROVIDER: 'verifik' }), /VERIFIK_API_KEY: Es obligatoria/);
    assert.throws(() => loadConfig({ ...base, RUNT_PROVIDER: 'scraping' }), /RUNT_PROVIDER/);

    const providerKey = 'k'.repeat(4);
    const config = loadConfig({ ...base, RUNT_PROVIDER: 'Verifik', VERIFIK_API_KEY: providerKey });
    assert.equal(createVehicleLookupProvider(config.runtProvider).name, 'verifik');
  });

  it('mientras no esté implementado, la consulta responde 501 sin llamar a ningún servicio', async () => {
    const ctx = await startTestApp({ lookupProvider: new VerifikVehicleLookupProvider('sin-uso') });
    try {
      const token = await ctx.registerVerified('verifik@example.com');
      await ctx.request('POST', '/garage', { token, body: { plate: 'ABC-123', brand: 'Renault', model: 'Sandero' } });
      assert.deepEqual((await ctx.request('GET', '/garage/capabilities', { token })).body.runtLookup, { enabled: true, provider: 'verifik' });
      const response = await ctx.request('POST', '/garage/ABC-123/refresh-from-runt', { token, body: consentBody() });
      assert.equal(response.status, 501);
      assert.equal(response.body.code, 'RUNT_PROVIDER_NOT_IMPLEMENTED');
    } finally {
      await ctx.close();
    }
  });
});
