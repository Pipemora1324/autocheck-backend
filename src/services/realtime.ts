import type { Server as HttpServer } from 'node:http';
import { createAdapter } from '@socket.io/redis-adapter';
import { Server as SocketServer, type Socket } from 'socket.io';
import type { UserRepository } from '../repositories/authRepositories.js';
import type { DiagnosisMessage } from '../repositories/diagnosisRepository.js';
import type { TokenService } from './tokenService.js';

export const MAX_CONNECTIONS_PER_USER = 5;
/** El servidor solo envía: ningún cliente tiene motivo para mandar mensajes grandes. */
const MAX_MESSAGE_BYTES = 16 * 1024;

export type RealtimeAction = 'created' | 'updated' | 'deleted';
export type DiagnosisStage = 'queued' | 'analyzing' | 'drafting' | 'done' | 'failed';

export interface RealtimeEvents {
  /** Otro cliente del mismo usuario creó, editó o borró un vehículo. */
  'garage:changed': { action: RealtimeAction; plate: string };
  'diagnosis:changed': { action: 'created' | 'deleted'; plate: string; id: string };
  /** En "done", result es la respuesta final ya validada por el piso de seguridad. */
  'diagnosis:progress': { requestId: string; stage: DiagnosisStage; result?: unknown; status?: string };
  /** La respuesta completa y ya validada: nunca fragmentos crudos del modelo. */
  'chat:message': { diagnosisId: string; question: DiagnosisMessage; answer: DiagnosisMessage; restantes: number };
  /** El token venció: el cliente debe renovarlo y reconectarse. */
  'session:expired': Record<string, never>;
}

export type RealtimeError = 'UNAUTHORIZED' | 'EMAIL_NOT_VERIFIED' | 'UNAVAILABLE';

export interface RealtimeNotifier {
  emit<E extends keyof RealtimeEvents>(userId: string, event: E, payload: RealtimeEvents[E]): void;
  disconnectUser(userId: string): void;
}

/** Sin tiempo real: el valor por defecto de los servicios. HTTP funciona igual. */
export const noRealtime: RealtimeNotifier = { emit: () => undefined, disconnectUser: () => undefined };

const roomFor = (userId: string) => `user:${userId}`;

const rejection = (code: RealtimeError) => Object.assign(new Error(code), { data: { code } });

/** Publicar nunca rechaza: el adaptador llama a publish sin .catch, y un rechazo terminaría el proceso. */
export function nonRejecting<T extends object>(client: T, methods: readonly string[]): T {
  return new Proxy(client, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property);
      if (typeof value !== 'function') return value;
      const bound = (value as (...args: unknown[]) => unknown).bind(target);
      if (typeof property !== 'string' || !methods.includes(property)) return bound;
      return (...args: unknown[]) => {
        try {
          return Promise.resolve(bound(...args)).catch(() => undefined);
        } catch {
          return Promise.resolve(undefined);
        }
      };
    }
  });
}

export interface SocketHubDeps {
  tokens: TokenService;
  users: UserRepository;
  corsOrigins: string[];
  now?: () => number;
}

/** Socket.IO sobre el mismo servidor HTTP. Solo del servidor a los clientes, en una sala por usuario. */
export class SocketHub implements RealtimeNotifier {
  private io: SocketServer | null = null;
  /** Por usuario, de la más antigua a la más reciente. */
  private readonly connections = new Map<string, Socket[]>();

  constructor(private readonly deps: SocketHubDeps) {}

  attach(server: HttpServer): void {
    this.io = new SocketServer(server, {
      cors: { origin: this.deps.corsOrigins },
      cookie: false,
      serveClient: false,
      maxHttpBufferSize: MAX_MESSAGE_BYTES,
      // CORS no aplica a WebSocket: el origen se comprueba aquí. Los clientes sin navegador no lo envían.
      allowRequest: (request, callback) => {
        const { origin } = request.headers;
        callback(null, !origin || this.deps.corsOrigins.includes(origin));
      }
    });
    this.io.use((socket, next) => {
      this.authenticate(socket).then(
        () => {
          next();
        },
        (error: unknown) => {
          next(error instanceof Error ? error : rejection('UNAVAILABLE'));
        }
      );
    });
    this.io.on('connection', (socket) => {
      this.onConnection(socket);
    });
  }

  /** Redis permite repartir los eventos entre varias instancias. Con una sola funciona igual sin él. */
  useRedisAdapter(publisher: object, subscriber: object): void {
    this.io?.adapter(
      createAdapter(nonRejecting(publisher, ['publish', 'sPublish']), nonRejecting(subscriber, ['pSubscribe']))
    );
  }

  /** Una falla de tiempo real nunca debe romper la petición HTTP que la originó. */
  emit<E extends keyof RealtimeEvents>(userId: string, event: E, payload: RealtimeEvents[E]): void {
    try {
      this.io?.to(roomFor(userId)).emit(event, payload);
    } catch (error) {
      console.warn(`No se pudo emitir ${event} (${(error as Error).name}).`);
    }
  }

  disconnectUser(userId: string): void {
    try {
      this.io?.in(roomFor(userId)).disconnectSockets(true);
    } catch (error) {
      console.warn(`No se pudo desconectar al usuario (${(error as Error).name}).`);
    }
  }

  /** También cierra el servidor HTTP al que está unido. */
  async close(): Promise<void> {
    await this.io?.close();
    this.io = null;
  }

  private async authenticate(socket: Socket): Promise<void> {
    const { token } = socket.handshake.auth as { token?: unknown };
    const user = typeof token === 'string' ? this.deps.tokens.verifyAccessToken(token) : null;
    if (!user || typeof token !== 'string') throw rejection('UNAUTHORIZED');

    const record = await this.deps.users.findById(user.id).catch(() => {
      throw rejection('UNAVAILABLE');
    });
    if (!record) throw rejection('UNAUTHORIZED');
    if (!record.emailVerifiedAt) throw rejection('EMAIL_NOT_VERIFIED');

    (socket.data as SocketData).userId = user.id;
    (socket.data as SocketData).expiresAt = this.deps.tokens.accessTokenExpiresAt(token);
  }

  private onConnection(socket: Socket): void {
    const { userId, expiresAt } = socket.data as SocketData;
    void socket.join(roomFor(userId));
    this.track(userId, socket);

    const now = this.deps.now?.() ?? Date.now();
    const expiry = setTimeout(
      () => {
        socket.emit('session:expired', {});
        socket.disconnect(true);
      },
      Math.max(0, expiresAt - now)
    );
    expiry.unref();

    socket.once('disconnect', () => {
      clearTimeout(expiry);
      const remaining = (this.connections.get(userId) ?? []).filter((item) => item !== socket);
      if (remaining.length > 0) this.connections.set(userId, remaining);
      else this.connections.delete(userId);
    });
  }

  /**
   * Al pasar del límite se cierra la conexión más antigua, no la nueva. Una página recién recargada deja su
   * socket contando hasta que el servidor nota que murió: rechazar la nueva dejaría sin conexión a quien
   * está usando la app, por culpa de conexiones que ya no existen.
   */
  private track(userId: string, socket: Socket): void {
    const sockets = [...(this.connections.get(userId) ?? []), socket];
    this.connections.set(userId, sockets);
    if (sockets.length > MAX_CONNECTIONS_PER_USER) sockets[0]?.disconnect(true);
  }
}

interface SocketData {
  userId: string;
  expiresAt: number;
}
