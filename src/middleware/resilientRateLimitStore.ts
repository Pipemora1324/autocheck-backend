import { createHash } from 'node:crypto';
import { MemoryStore, type ClientRateLimitInfo, type Options, type Store } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import type { RedisConnection } from '../services/redis.js';

/** Las claves del límite pueden llevar la IP o el correo: a Redis solo llega su hash. */
const hashed = (key: string) => createHash('sha256').update(key).digest('hex');

/**
 * Cuenta en el almacén distribuido si está disponible y en memoria si no.
 * El distribuido se crea tarde y dentro de un try: su init carga scripts y puede rechazar, y un rechazo
 * sin manejar terminaría el proceso. Si falla, se reintenta en la siguiente petición.
 */
export class ResilientStore implements Store {
  readonly localKeys = true;
  private readonly memory = new MemoryStore();
  private primary: Store | null = null;
  private options: Options | null = null;

  constructor(
    private readonly isReady: () => boolean,
    private readonly createPrimary: () => Store
  ) {}

  init(options: Options): void {
    this.options = options;
    this.memory.init(options);
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    try {
      const primary = await this.readyPrimary();
      if (primary) return await primary.increment(hashed(key));
    } catch {
      this.primary = null;
    }
    return this.memory.increment(key);
  }

  async decrement(key: string): Promise<void> {
    await this.onBoth(key, (store, storeKey) => store.decrement(storeKey));
  }

  async resetKey(key: string): Promise<void> {
    await this.onBoth(key, (store, storeKey) => store.resetKey(storeKey));
  }

  private async readyPrimary(): Promise<Store | null> {
    if (!this.isReady()) return null;
    if (this.primary) return this.primary;
    const created = this.createPrimary();
    if (this.options) await created.init?.(this.options);
    this.primary = created;
    return created;
  }

  private async onBoth(key: string, action: (store: Store, storeKey: string) => void | Promise<void>): Promise<void> {
    await action(this.memory, key);
    try {
      const primary = await this.readyPrimary();
      if (primary) await action(primary, hashed(key));
    } catch {
      this.primary = null;
    }
  }
}

/** Sin conexión, cada límite usa el almacén en memoria de express-rate-limit. */
export function rateLimitStores(redis: RedisConnection | null): ((name: string) => Store) | undefined {
  if (!redis) return undefined;
  return (name) =>
    new ResilientStore(
      () => redis.isReady(),
      () =>
        new RedisStore({
          prefix: `v1:rl:${name}:`,
          sendCommand: (...args: string[]) => redis.sendCommand(args)
        })
    );
}
