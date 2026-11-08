import type { KeyValueBackend } from './redis.js';

const MEMORY_MAX_ENTRIES = 1_000;

export const CACHE_TTL_SECONDS = { catalog: 300, lists: 60 } as const;

/**
 * Las claves llevan una versión y solo ids: nunca correos, placas ni textos.
 * En la caché tampoco entran imágenes ni el contenido del chat.
 */
export const cacheKeys = {
  telltales: 'v1:catalog:telltales',
  userPrefix: (userId: string) => `v1:user:${userId}:`,
  garage: (userId: string) => `v1:user:${userId}:garage`,
  history: (userId: string, vehicleId: string, page: number, limit: number) =>
    `v1:user:${userId}:vehicle:${vehicleId}:history:${page}:${limit}`
};

export interface Cache {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  deleteByPrefix(prefix: string): Promise<void>;
}

/** Sin caché: es el valor por defecto de los servicios, para que cada lectura vaya a la base. */
export const noCache: Cache = {
  get: () => Promise.resolve(null),
  set: () => Promise.resolve(),
  deleteByPrefix: () => Promise.resolve()
};

/** Guarda JSON, no referencias: lo que se lee nunca comparte objetos con lo que se guardó. */
export class MemoryCache implements Cache {
  private readonly entries = new Map<string, { value: string; expiresAt: number }>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxEntries = MEMORY_MAX_ENTRIES
  ) {}

  get<T>(key: string): Promise<T | null> {
    const entry = this.entries.get(key);
    if (!entry) return Promise.resolve(null);
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return Promise.resolve(null);
    }
    return Promise.resolve(JSON.parse(entry.value) as T);
  }

  set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    this.entries.delete(key);
    this.entries.set(key, { value: JSON.stringify(value), expiresAt: this.now() + ttlSeconds * 1000 });
    // Un Map conserva el orden de inserción: el primero es el más antiguo.
    if (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
    return Promise.resolve();
  }

  deleteByPrefix(prefix: string): Promise<void> {
    for (const key of this.entries.keys()) if (key.startsWith(prefix)) this.entries.delete(key);
    return Promise.resolve();
  }

  get size(): number {
    return this.entries.size;
  }
}

/**
 * Usa Redis si está disponible y memoria si no: una falla de Redis nunca llega al usuario.
 * Si Redis se cae y vuelve, puede servir una lista vieja hasta que venza su TTL, que por eso es corto.
 */
export class ResilientCache implements Cache {
  constructor(
    private readonly backend: KeyValueBackend | null,
    private readonly memory: Cache = new MemoryCache()
  ) {}

  async get<T>(key: string): Promise<T | null> {
    if (this.backend?.isReady()) {
      try {
        const value = await this.backend.get(key);
        return value === null ? null : (JSON.parse(value) as T);
      } catch {
        return this.memory.get<T>(key);
      }
    }
    return this.memory.get<T>(key);
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (this.backend?.isReady()) {
      try {
        await this.backend.setWithTtl(key, JSON.stringify(value), ttlSeconds);
        return;
      } catch {
        // Sigue con memoria.
      }
    }
    await this.memory.set(key, value, ttlSeconds);
  }

  /** Siempre borra en los dos lados: la memoria pudo llenarse mientras Redis estaba caído. */
  async deleteByPrefix(prefix: string): Promise<void> {
    await this.memory.deleteByPrefix(prefix);
    if (!this.backend?.isReady()) return;
    try {
      await this.backend.deleteByPrefix(prefix);
    } catch {
      // El TTL corto limita el tiempo que puede sobrevivir una entrada vieja.
    }
  }
}

/** Devuelve lo guardado o lo carga y lo guarda. Una lectura que falla nunca se guarda. */
export async function cached<T>(cache: Cache, key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
  const hit = await cache.get<T>(key);
  if (hit !== null) return hit;
  const value = await load();
  await cache.set(key, value, ttlSeconds);
  return value;
}
