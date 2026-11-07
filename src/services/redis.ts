import { createClient } from 'redis';

export type RedisStatus = 'disabled' | 'ok' | 'degraded';
type RedisClient = ReturnType<typeof createClient>;

const CONNECT_TIMEOUT_MS = 5_000;
const MAX_RECONNECT_DELAY_MS = 10_000;

/** Nunca se registra la URL ni el mensaje completo: pueden incluir la contraseña. */
const errorCode = (error: unknown): string =>
  error instanceof Error ? ((error as NodeJS.ErrnoException).code ?? error.name) : 'desconocido';

const newClient = (url: string): RedisClient =>
  createClient({
    url,
    // Sin cola: con Redis caído, los comandos fallan de inmediato y se usa el respaldo en memoria.
    disableOfflineQueue: true,
    socket: {
      connectTimeout: CONNECT_TIMEOUT_MS,
      reconnectStrategy: (retries) => Math.min(250 * 2 ** retries, MAX_RECONNECT_DELAY_MS)
    }
  });

/** Lo que el resto de la aplicación necesita de Redis, para poder simularlo en las pruebas. */
export interface KeyValueBackend {
  isReady(): boolean;
  get(key: string): Promise<string | null>;
  setWithTtl(key: string, value: string, ttlSeconds: number): Promise<void>;
  deleteByPrefix(prefix: string): Promise<void>;
}

/** Conexión opcional y sin bloquear: la API arranca y responde aunque Redis nunca conecte. */
export class RedisConnection implements KeyValueBackend {
  readonly client: RedisClient;
  private readonly extraClients: RedisClient[] = [];
  private loggedFailure = false;

  constructor(private readonly url: string) {
    this.client = this.track(newClient(url), 'principal');
    this.client.on('ready', () => {
      this.loggedFailure = false;
      console.log('Redis conectado.');
    });
    this.client.connect().catch((error: unknown) => {
      this.logFailure('principal', error);
    });
  }

  isReady(): boolean {
    return this.client.isReady;
  }

  status(): RedisStatus {
    return this.isReady() ? 'ok' : 'degraded';
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async setWithTtl(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.client.setEx(key, ttlSeconds, value);
  }

  async deleteByPrefix(prefix: string): Promise<void> {
    for await (const keys of this.client.scanIterator({ MATCH: `${prefix}*`, COUNT: 100 })) {
      if (keys.length > 0) await this.client.unlink(keys);
    }
  }

  sendCommand(args: string[]): Promise<boolean | number | string | Array<boolean | number | string>> {
    return this.client.sendCommand(args);
  }

  /** Llama a callback una sola vez, cuando Redis esté listo por primera vez. */
  onFirstReady(callback: () => void): void {
    if (this.isReady()) callback();
    else this.client.once('ready', callback);
  }

  /** Dos conexiones más para Pub/Sub, que no pueden compartirse con los comandos normales. */
  async pubSubClients(): Promise<{ publisher: RedisClient; subscriber: RedisClient }> {
    const publisher = this.track(newClient(this.url), 'publicación');
    const subscriber = this.track(newClient(this.url), 'suscripción');
    this.extraClients.push(publisher, subscriber);
    await Promise.all([publisher.connect(), subscriber.connect()]);
    return { publisher, subscriber };
  }

  async close(): Promise<void> {
    await Promise.allSettled(
      [this.client, ...this.extraClients].map((client) => (client.isOpen ? client.close() : Promise.resolve()))
    );
  }

  private track(client: RedisClient, name: string): RedisClient {
    // Sin este oyente, un 'error' sin manejar terminaría el proceso.
    client.on('error', (error: unknown) => {
      this.logFailure(name, error);
    });
    return client;
  }

  private logFailure(name: string, error: unknown): void {
    if (this.loggedFailure) return;
    this.loggedFailure = true;
    console.warn(`Redis no disponible (${name}: ${errorCode(error)}): se usa el respaldo en memoria.`);
  }
}
