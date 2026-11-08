import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { rateLimit } from 'express-rate-limit';
import express from 'express';
import { io } from 'socket.io-client';
import { rateLimitStores } from '../src/middleware/resilientRateLimitStore.js';
import { ResilientCache } from '../src/services/cache.js';
import { SocketHub } from '../src/services/realtime.js';
import { RedisConnection } from '../src/services/redis.js';
import { TokenService } from '../src/services/tokenService.js';
import { MemoryUserRepository } from './support/memoryRepositories.js';

// Un puerto donde no escucha nadie: comprueba de verdad qué pasa con Redis caído, sin simularlo.
const UNREACHABLE_URL = 'redis://127.0.0.1:1';

describe('Redis caído (conexión real a un puerto cerrado)', () => {
  const originalWarn = console.warn;
  let redis: RedisConnection;
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);

  before(() => {
    console.warn = () => undefined;
    process.on('unhandledRejection', onUnhandled);
    redis = new RedisConnection(UNREACHABLE_URL);
  });
  after(async () => {
    await redis.close();
    process.off('unhandledRejection', onUnhandled);
    console.warn = originalWarn;
  });

  it('informa degraded y no bloquea', () => {
    assert.equal(redis.status(), 'degraded');
    assert.equal(redis.isReady(), false);
  });

  it('la caché funciona en memoria', async () => {
    const cache = new ResilientCache(redis);
    await cache.set('v1:prueba', { a: 1 }, 30);
    assert.deepEqual(await cache.get('v1:prueba'), { a: 1 });
    await cache.deleteByPrefix('v1:');
    assert.equal(await cache.get('v1:prueba'), null);
  });

  it('los límites siguen contando en memoria', async () => {
    const storeFor = rateLimitStores(redis)!;
    const app = express();
    app.get(
      '/',
      rateLimit({ windowMs: 60_000, limit: 1, store: storeFor('prueba-caido'), validate: false }),
      (_request, response) => {
        response.json({ ok: true });
      }
    );
    const server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, () => {
        resolve(listening);
      });
    });
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    try {
      assert.equal((await fetch(url)).status, 200);
      assert.equal((await fetch(url)).status, 429);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('ninguna promesa quedó sin manejar', async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.deepEqual(unhandled, []);
  });
});

// Requiere un Redis real. En CI lo da el servicio del workflow.
const redisUrl = process.env.TEST_REDIS_URL;

describe('Redis real (integración)', { skip: redisUrl ? false : 'TEST_REDIS_URL no definida' }, () => {
  let redis: RedisConnection;

  before(async () => {
    redis = new RedisConnection(redisUrl!);
    await new Promise<void>((resolve) => {
      redis.onFirstReady(resolve);
    });
  });
  after(() => redis.close());

  it('informa ok', () => {
    assert.equal(redis.status(), 'ok');
  });

  it('guarda con TTL, lee y borra por prefijo, sin tocar otras claves', async () => {
    const cache = new ResilientCache(redis);
    await cache.set('v1:prueba:user:a:x', { a: 1 }, 30);
    await cache.set('v1:prueba:user:a:y', { a: 2 }, 30);
    await cache.set('v1:prueba:user:b:x', { b: 1 }, 30);
    assert.deepEqual(await cache.get('v1:prueba:user:a:x'), { a: 1 });
    const ttl = await redis.client.ttl('v1:prueba:user:a:x');
    assert.ok(ttl > 0 && ttl <= 30, `ttl ${ttl}`);

    await cache.deleteByPrefix('v1:prueba:user:a:');
    assert.equal(await cache.get('v1:prueba:user:a:x'), null);
    assert.equal(await cache.get('v1:prueba:user:a:y'), null);
    assert.deepEqual(await cache.get('v1:prueba:user:b:x'), { b: 1 });
    await cache.deleteByPrefix('v1:prueba:');
  });

  it('dos instancias comparten el contador del límite, y en Redis no hay correos', async () => {
    const storeFor = rateLimitStores(redis)!;
    const name = `prueba-${Date.now()}`;
    const apps = [storeFor(name), storeFor(name)].map((store) => {
      const app = express();
      app.get(
        '/',
        rateLimit({
          windowMs: 60_000,
          limit: 2,
          store,
          validate: false,
          keyGenerator: () => 'email:ana@example.com'
        }),
        (_request, response) => {
          response.json({ ok: true });
        }
      );
      return app;
    });
    const servers = await Promise.all(
      apps.map(
        (app) =>
          new Promise<Server>((resolve) => {
            const listening = app.listen(0, () => {
              resolve(listening);
            });
          })
      )
    );
    const urls = servers.map((server) => `http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
    try {
      assert.equal((await fetch(urls[0])).status, 200);
      assert.equal((await fetch(urls[1])).status, 200);
      assert.equal((await fetch(urls[0])).status, 429, 'el contador es compartido');

      const keys = await redis.client.keys(`v1:rl:${name}:*`);
      assert.equal(keys.length, 1);
      assert.doesNotMatch(keys[0], /ana|example/);
    } finally {
      await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
    }
  });

  it('el adaptador entrega un evento a un cliente conectado en otra instancia', async () => {
    const users = new MemoryUserRepository();
    const tokens = new TokenService('a'.repeat(32), 'b'.repeat(32));
    const user = (await users.create({
      email: 'adaptador@example.com',
      passwordHash: 'x',
      termsAcceptedAt: new Date(),
      termsVersion: '1'
    }))!;
    await users.markEmailVerified(user.id, new Date());

    const hubs = [new SocketHub({ tokens, users, corsOrigins: [] }), new SocketHub({ tokens, users, corsOrigins: [] })];
    const servers = hubs.map(() => createServer());
    await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.listen(0, resolve))));
    const connections: RedisConnection[] = [];
    for (const [index, hub] of hubs.entries()) {
      hub.attach(servers[index]);
      const connection = new RedisConnection(redisUrl!);
      connections.push(connection);
      await new Promise<void>((resolve) => {
        connection.onFirstReady(resolve);
      });
      const { publisher, subscriber } = await connection.pubSubClients();
      hub.useRedisAdapter(publisher, subscriber);
    }

    const port = (servers[1].address() as AddressInfo).port;
    const token = tokens.signAccessToken({ id: user.id, email: user.email, role: 'user' });
    const socket = io(`http://127.0.0.1:${port}`, { auth: { token }, reconnection: false, forceNew: true });
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      const received = new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('El evento no cruzó de instancia'));
        }, 3000);
        socket.once('garage:changed', (payload: unknown) => {
          clearTimeout(timer);
          resolve(payload);
        });
      });
      // Se emite desde la instancia 0, y el cliente está en la 1.
      hubs[0].emit(user.id, 'garage:changed', { action: 'created', plate: 'ABC-123' });
      assert.deepEqual(await received, { action: 'created', plate: 'ABC-123' });
    } finally {
      socket.disconnect();
      await Promise.all(hubs.map((hub) => hub.close()));
      await Promise.all(connections.map((connection) => connection.close()));
    }
  });
});
