import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Options, Store } from 'express-rate-limit';
import { rateLimitStores, ResilientStore } from '../src/middleware/resilientRateLimitStore.js';

const OPTIONS = { windowMs: 60_000 } as Options;

class FakeStore implements Store {
  readonly keys: string[] = [];
  readonly decremented: string[] = [];
  readonly reset: string[] = [];
  hits = 0;
  initFails = false;
  failing = false;

  async init() {
    if (this.initFails) throw new Error('no cargó los scripts');
  }
  async increment(key: string) {
    if (this.failing) throw new Error('redis caído');
    this.keys.push(key);
    return { totalHits: ++this.hits, resetTime: new Date(Date.now() + 1000) };
  }
  async decrement(key: string) {
    if (this.failing) throw new Error('redis caído');
    this.decremented.push(key);
  }
  async resetKey(key: string) {
    if (this.failing) throw new Error('redis caído');
    this.reset.push(key);
  }
}

const store = (fake: FakeStore, ready = () => true) => {
  const resilient = new ResilientStore(ready, () => fake);
  resilient.init(OPTIONS);
  return resilient;
};

describe('ResilientStore', () => {
  it('cuenta en el almacén distribuido, y a él solo llega el hash de la clave', async () => {
    const fake = new FakeStore();
    const resilient = store(fake);
    assert.equal((await resilient.increment('email:ana@example.com')).totalHits, 1);
    assert.equal(fake.keys.length, 1);
    assert.match(fake.keys[0], /^[0-9a-f]{64}$/);
    assert.doesNotMatch(fake.keys[0], /ana|example/);
  });

  it('sin Redis listo cuenta en memoria, y sigue limitando', async () => {
    const fake = new FakeStore();
    const resilient = store(fake, () => false);
    await resilient.increment('k');
    assert.equal((await resilient.increment('k')).totalHits, 2);
    assert.equal(fake.keys.length, 0);
  });

  it('si Redis falla al contar, usa memoria sin propagar el error', async () => {
    const fake = new FakeStore();
    fake.failing = true;
    const resilient = store(fake);
    assert.equal((await resilient.increment('k')).totalHits, 1);
    assert.equal((await resilient.increment('k')).totalHits, 2);
  });

  it('si no carga sus scripts no rechaza, y reintenta en la siguiente petición', async () => {
    const fake = new FakeStore();
    fake.initFails = true;
    const resilient = store(fake);
    assert.equal((await resilient.increment('k')).totalHits, 1);
    fake.initFails = false;
    await resilient.increment('k');
    assert.equal(fake.keys.length, 1, 'al recuperarse vuelve al distribuido');
  });

  it('decrementar y reiniciar nunca propagan una falla de Redis', async () => {
    const fake = new FakeStore();
    const resilient = store(fake);
    await resilient.increment('k');
    await resilient.decrement('k');
    await resilient.resetKey('k');
    assert.equal(fake.decremented.length, 1);
    assert.equal(fake.reset.length, 1);

    fake.failing = true;
    await resilient.decrement('k');
    await resilient.resetKey('k');
  });
});

describe('rateLimitStores', () => {
  it('sin conexión no hay almacén: cada límite usa su memoria', () => {
    assert.equal(rateLimitStores(null), undefined);
  });
});
