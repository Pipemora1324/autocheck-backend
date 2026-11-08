import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import {
  cached,
  cacheKeys,
  CACHE_TTL_SECONDS,
  MemoryCache,
  noCache,
  ResilientCache,
  type Cache
} from '../src/services/cache.js';
import type { KeyValueBackend } from '../src/services/redis.js';
import { DEFAULT_CLAVE, startTestApp, type TestContext } from './support/testApp.js';

/** Redis simulado: puede estar "caído" o fallar en cada comando. */
class FakeBackend implements KeyValueBackend {
  readonly data = new Map<string, { value: string; ttl: number }>();
  ready = true;
  failing = false;

  isReady() {
    return this.ready;
  }
  async get(key: string) {
    if (this.failing) throw new Error('redis caído');
    return this.data.get(key)?.value ?? null;
  }
  async setWithTtl(key: string, value: string, ttl: number) {
    if (this.failing) throw new Error('redis caído');
    this.data.set(key, { value, ttl });
  }
  async deleteByPrefix(prefix: string) {
    if (this.failing) throw new Error('redis caído');
    for (const key of this.data.keys()) if (key.startsWith(prefix)) this.data.delete(key);
  }
}

const USER = '11111111-1111-4111-8111-111111111111';
const VEHICLE = '22222222-2222-4222-8222-222222222222';

describe('Claves de la caché', () => {
  it('llevan versión y solo ids: nada de correos, placas ni textos', () => {
    for (const key of [
      cacheKeys.telltales,
      cacheKeys.garage(USER),
      cacheKeys.history(USER, VEHICLE, 1, 20),
      cacheKeys.userPrefix(USER)
    ]) {
      assert.match(key, /^v1:/);
      assert.doesNotMatch(key, /@|[A-Z]{3}-?\d{3}/);
    }
  });

  it('todas las claves del usuario comparten el prefijo que se invalida', () => {
    assert.ok(cacheKeys.garage(USER).startsWith(cacheKeys.userPrefix(USER)));
    assert.ok(cacheKeys.history(USER, VEHICLE, 1, 20).startsWith(cacheKeys.userPrefix(USER)));
  });

  it('los TTL son cortos', () => {
    assert.deepEqual(CACHE_TTL_SECONDS, { catalog: 300, lists: 60 });
  });
});

describe('MemoryCache', () => {
  it('vence por TTL y no comparte objetos con quien lee', async () => {
    let now = 1000;
    const cache = new MemoryCache(() => now);
    const original = { a: 1 };
    await cache.set('k', original, 10);
    const read = await cache.get<{ a: number }>('k');
    assert.deepEqual(read, { a: 1 });
    assert.notEqual(read, original);
    now += 10_000;
    assert.equal(await cache.get('k'), null);
    assert.equal(cache.size, 0);
  });

  it('borra por prefijo y solo ese prefijo', async () => {
    const cache = new MemoryCache();
    await cache.set('v1:user:a:x', 1, 60);
    await cache.set('v1:user:b:x', 2, 60);
    await cache.deleteByPrefix('v1:user:a:');
    assert.equal(await cache.get('v1:user:a:x'), null);
    assert.equal(await cache.get('v1:user:b:x'), 2);
  });

  it('no crece sin límite: descarta la entrada más antigua', async () => {
    const cache = new MemoryCache(Date.now, 2);
    await cache.set('a', 1, 60);
    await cache.set('b', 2, 60);
    await cache.set('c', 3, 60);
    assert.equal(cache.size, 2);
    assert.equal(await cache.get('a'), null);
    assert.equal(await cache.get('c'), 3);
  });
});

describe('ResilientCache', () => {
  it('con Redis listo, guarda en Redis con TTL', async () => {
    const backend = new FakeBackend();
    const cache = new ResilientCache(backend);
    await cache.set('k', { a: 1 }, 30);
    assert.deepEqual(backend.data.get('k'), { value: '{"a":1}', ttl: 30 });
    assert.deepEqual(await cache.get('k'), { a: 1 });
  });

  it('sin REDIS_URL usa memoria', async () => {
    const cache = new ResilientCache(null);
    await cache.set('k', 1, 30);
    assert.equal(await cache.get('k'), 1);
    await cache.deleteByPrefix('k');
    assert.equal(await cache.get('k'), null);
  });

  it('con Redis desconectado usa memoria, sin llamarlo', async () => {
    const backend = new FakeBackend();
    backend.ready = false;
    const cache = new ResilientCache(backend);
    await cache.set('k', 1, 30);
    assert.equal(backend.data.size, 0);
    assert.equal(await cache.get('k'), 1);
  });

  it('si un comando falla, nada se propaga y se usa memoria', async () => {
    const backend = new FakeBackend();
    backend.failing = true;
    const cache = new ResilientCache(backend);
    await cache.set('k', 1, 30);
    assert.equal(await cache.get('k'), 1);
    await cache.deleteByPrefix('k');
    assert.equal(await cache.get('k'), null);
  });

  it('invalidar borra también lo guardado en memoria mientras Redis estaba caído', async () => {
    const backend = new FakeBackend();
    backend.ready = false;
    const cache = new ResilientCache(backend);
    await cache.set('v1:user:a:x', 'viejo', 60);
    backend.ready = true;
    await cache.deleteByPrefix('v1:user:a:');
    backend.ready = false;
    assert.equal(await cache.get('v1:user:a:x'), null);
  });
});

describe('cached', () => {
  it('carga una sola vez, y un error no se guarda', async () => {
    const cache = new MemoryCache();
    let loads = 0;
    const load = async () => ++loads;
    assert.equal(await cached(cache, 'k', 60, load), 1);
    assert.equal(await cached(cache, 'k', 60, load), 1);

    await assert.rejects(cached(cache, 'e', 60, () => Promise.reject(new Error('base caída'))));
    assert.equal(await cached(cache, 'e', 60, () => Promise.resolve('bien')), 'bien');
  });

  it('noCache nunca guarda', async () => {
    await noCache.set('k', 1, 60);
    assert.equal(await noCache.get('k'), null);
    await noCache.deleteByPrefix('k');
  });
});

describe('Caché en la API', () => {
  let ctx: TestContext;
  let cache: MemoryCache;
  let ana: string;
  let luis: string;
  const addVehicle = (token: string, plate: string) =>
    ctx.request('POST', '/garage', { token, body: { plate, brand: 'Renault', model: 'Sandero' } });
  const garage = (token: string) => ctx.request('GET', '/garage', { token });
  const plates = (response: { body: { vehicles: Array<{ plate: string }> } }) =>
    response.body.vehicles.map((item) => item.plate);

  before(async () => {
    cache = new MemoryCache();
    ctx = await startTestApp({ cache });
    ana = await ctx.registerVerified('cache.ana@example.com');
    luis = await ctx.registerVerified('cache.luis@example.com');
  });
  after(() => ctx.close());
  beforeEach(async () => {
    await cache.deleteByPrefix('');
  });

  it('el listado se sirve de la caché y crear, editar o borrar lo invalida', async () => {
    await addVehicle(ana, 'CAC-001');
    assert.deepEqual(plates(await garage(ana)), ['CAC-001']);

    // Cambia la fuente sin pasar por el servicio: si responde igual, es que salió de la caché.
    const record = ctx.garage.vehicles.find((item) => item.plate === 'CAC-001')!;
    record.brand = 'Cambiada';
    assert.equal((await garage(ana)).body.vehicles[0].brand, 'Renault');

    await ctx.request('PATCH', '/garage/CAC-001', { token: ana, body: { color: 'Rojo' } });
    assert.equal((await garage(ana)).body.vehicles[0].brand, 'Cambiada');

    await addVehicle(ana, 'CAC-002');
    assert.deepEqual(plates(await garage(ana)), ['CAC-001', 'CAC-002']);

    await ctx.request('DELETE', '/garage/CAC-002', { token: ana });
    assert.deepEqual(plates(await garage(ana)), ['CAC-001']);
  });

  it('la caché es por usuario', async () => {
    await addVehicle(luis, 'LUI-001');
    assert.deepEqual(plates(await garage(luis)), ['LUI-001']);
    assert.ok(!plates(await garage(ana)).includes('LUI-001'));
  });

  it('el historial se invalida al crear y borrar un diagnóstico', async () => {
    await addVehicle(ana, 'HIS-001');
    const history = () => ctx.request('GET', '/garage/HIS-001/diagnoses', { token: ana });
    assert.equal((await history()).body.total, 0);

    const created = await ctx.postForm('/garage/HIS-001/diagnoses', { token: ana, fields: { telltaleId: 'tpms' } });
    assert.equal((await history()).body.total, 1);

    // Cambia la fuente sin pasar por el servicio: si responde igual, es que salió de la caché.
    ctx.diagnoses.diagnoses.find((item) => item.id === created.body.id)!.descripcion = 'cambiada';
    assert.equal((await history()).body.items[0].descripcion, null);

    await ctx.request('DELETE', `/garage/HIS-001/diagnoses/${created.body.id}`, { token: ana });
    assert.equal((await history()).body.total, 0);
  });

  it('el catálogo de testigos se cachea', async () => {
    const first = await ctx.request('GET', '/telltales', { token: ana });
    assert.equal(first.status, 200);
    assert.ok(await cache.get(cacheKeys.telltales));
    assert.deepEqual((await ctx.request('GET', '/telltales', { token: ana })).body, first.body);
  });
});

describe('Borrado de cuenta y caché', () => {
  it('borra todas las claves de ese usuario, y solo las suyas', async () => {
    const cache = new MemoryCache();
    const ctx = await startTestApp({ cache });
    try {
      const ana = await ctx.registerVerified('cache.borrar.ana@example.com');
      const luis = await ctx.registerVerified('cache.borrar.luis@example.com');
      const anaId = (await ctx.users.findByEmail('cache.borrar.ana@example.com'))!.id;
      const luisId = (await ctx.users.findByEmail('cache.borrar.luis@example.com'))!.id;
      await ctx.request('GET', '/garage', { token: ana });
      await ctx.request('GET', '/garage', { token: luis });
      assert.ok(await cache.get(cacheKeys.garage(anaId)));

      const deleted = await ctx.request('DELETE', '/auth/me', { token: ana, body: { password: DEFAULT_CLAVE } });
      assert.equal(deleted.status, 204);
      assert.equal(await cache.get(cacheKeys.garage(anaId)), null);
      assert.ok(await cache.get(cacheKeys.garage(luisId)));
    } finally {
      await ctx.close();
    }
  });

  it('si la limpieza falla, la cuenta queda borrada igual', async () => {
    const memory = new MemoryCache();
    let failing = false;
    const cache: Cache = {
      get: (key) => memory.get(key),
      set: (key, value, ttl) => memory.set(key, value, ttl),
      deleteByPrefix: (prefix) => (failing ? Promise.reject(new Error('caché caída')) : memory.deleteByPrefix(prefix))
    };
    const ctx = await startTestApp({ cache });
    const original = console.error;
    const logged: string[] = [];
    console.error = (...args: unknown[]) => logged.push(args.join(' '));
    try {
      const ana = await ctx.registerVerified('cache.falla@example.com');
      failing = true;
      const deleted = await ctx.request('DELETE', '/auth/me', { token: ana, body: { password: DEFAULT_CLAVE } });
      assert.equal(deleted.status, 204);
      assert.equal(await ctx.users.findByEmail('cache.falla@example.com'), null);
      assert.match(logged.join(), /limpieza/);
    } finally {
      console.error = original;
      await ctx.close();
    }
  });
});

describe('/health', () => {
  it('Redis caído no es un error: solo se cuenta en su campo', async () => {
    const degraded = await startTestApp({ redisStatus: () => 'degraded' });
    try {
      const response = await degraded.request('GET', '/health');
      assert.equal(response.status, 200);
      assert.equal(response.body.status, 'ok');
      assert.equal(response.body.redis, 'degraded');
    } finally {
      await degraded.close();
    }
  });

  it('sin Redis se informa como apagado', async () => {
    const off = await startTestApp();
    try {
      assert.equal((await off.request('GET', '/health')).body.redis, 'disabled');
    } finally {
      await off.close();
    }
  });
});
