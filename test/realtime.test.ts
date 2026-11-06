import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { io, type Socket } from 'socket.io-client';
import { CHAT_SAFE_STOP_ANSWER } from '../src/services/diagnosisChat.js';
import { MAX_CONNECTIONS_PER_USER, noRealtime, nonRejecting } from '../src/services/realtime.js';
import { FakeGemini, modelTelltale, reading } from './support/fakeGemini.js';
import { DEFAULT_CLAVE, startTestApp, type TestContext } from './support/testApp.js';

const PLATE = 'ABC-123';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

describe('Socket.IO', () => {
  let ctx: TestContext;
  let gemini: FakeGemini;
  let ana: string;
  let luis: string;
  const open: Socket[] = [];

  /** Crea el cliente, sin reconexión: cada prueba decide qué pasa. */
  const client = (token: unknown, extra: Record<string, unknown> = {}) => {
    const socket = io(ctx.baseUrl, { auth: { token }, reconnection: false, forceNew: true, ...extra });
    open.push(socket);
    return socket;
  };
  const connected = (socket: Socket) =>
    new Promise<void>((resolve, reject) => {
      if (socket.connected) {
        resolve();
        return;
      }
      socket.once('connect', () => {
        resolve();
      });
      socket.once('connect_error', reject);
    });
  const rejected = (socket: Socket) =>
    new Promise<{ message: string; data?: { code?: string } }>((resolve, reject) => {
      socket.once('connect', () => {
        reject(new Error('Se conectó y debía rechazarse'));
      });
      socket.once('connect_error', (error) => {
        resolve(error);
      });
    });
  const nextEvent = <T>(socket: Socket, event: string) =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`No llegó ${event}`));
      }, 2000);
      socket.once(event, (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
  const collect = <T>(socket: Socket, event: string) => {
    const items: T[] = [];
    socket.on(event, (payload: T) => items.push(payload));
    return items;
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 80));
  const addVehicle = (token: string, plate = PLATE) =>
    ctx.request('POST', '/garage', { token, body: { plate, brand: 'Renault', model: 'Sandero' } });

  before(async () => {
    gemini = new FakeGemini();
    ctx = await startTestApp({ telltaleIdentifier: gemini.identifier, chatResponder: gemini.chat });
    ana = await ctx.registerVerified('socket.ana@example.com');
    luis = await ctx.registerVerified('socket.luis@example.com');
    await addVehicle(ana);
  });
  after(() => ctx.close());
  beforeEach(() => {
    gemini.answer(reading());
  });
  afterEach(async () => {
    for (const socket of open.splice(0)) socket.disconnect();
    await settle();
  });

  describe('autenticación en el handshake', () => {
    it('acepta un token válido de un correo verificado', async () => {
      const socket = client(ana);
      await connected(socket);
      assert.equal(socket.connected, true);
    });

    it('rechaza sin token, con un token inválido o con uno de otro secreto', async () => {
      for (const token of [undefined, 'no-es-un-token', 12345]) {
        const error = await rejected(client(token));
        assert.equal(error.data?.code, 'UNAUTHORIZED');
      }
    });

    it('rechaza un correo sin verificar', async () => {
      const token = (await ctx.register('socket.sinverificar@example.com')).body.accessToken;
      const error = await rejected(client(token));
      assert.equal(error.data?.code, 'EMAIL_NOT_VERIFIED');
    });

    it('un refresh token no sirve como access token', async () => {
      const registered = await ctx.register('socket.refresh@example.com');
      const refresh = registered.cookie?.split('=')[1];
      assert.ok(refresh);
      assert.equal((await rejected(client(refresh))).data?.code, 'UNAUTHORIZED');
    });

    it('rechaza un origen distinto del frontend, y acepta el suyo', async () => {
      const foreign = client(ana, { extraHeaders: { origin: 'https://sitio-ajeno.example' }, transports: ['polling'] });
      await rejected(foreign);

      const own = client(ana, { extraHeaders: { origin: 'http://localhost:4200' }, transports: ['polling'] });
      await connected(own);
    });

    it(`limita a ${MAX_CONNECTIONS_PER_USER} conexiones por usuario: la nueva entra y sale la más antigua`, async () => {
      const sockets: Socket[] = [];
      for (let index = 0; index < MAX_CONNECTIONS_PER_USER; index++) {
        const socket = client(ana);
        await connected(socket);
        sockets.push(socket);
      }
      const other = client(luis);
      await connected(other);

      const oldestClosed = nextEvent<string>(sockets[0], 'disconnect');
      const newest = client(ana);
      await connected(newest);
      assert.equal(await oldestClosed, 'io server disconnect');
      await settle();

      assert.equal(newest.connected, true, 'quien está usando la app no se queda sin conexión');
      assert.equal(
        sockets.slice(1).every((socket) => socket.connected),
        true
      );
      assert.equal(other.connected, true, 'no afecta a otro usuario');
    });

    it('recargar muchas veces seguidas nunca deja sin conexión, aunque las viejas sigan contando', async () => {
      const abandoned = Array.from({ length: MAX_CONNECTIONS_PER_USER * 2 }, () => client(ana));
      for (const socket of abandoned) await connected(socket);
      await settle();
      assert.equal(abandoned.at(-1)!.connected, true);
      assert.equal(abandoned.filter((socket) => socket.connected).length, MAX_CONNECTIONS_PER_USER);
    });
  });

  describe('sincronización entre conexiones del mismo usuario', () => {
    it('crear, editar y borrar un vehículo llega a las dos conexiones, y no a otro usuario', async () => {
      const first = client(ana);
      const second = client(ana);
      const other = client(luis);
      await Promise.all([connected(first), connected(second), connected(other)]);
      const foreign = collect(other, 'garage:changed');

      for (const [action, run] of [
        ['created', () => addVehicle(ana, 'SYN-001')],
        ['updated', () => ctx.request('PATCH', '/garage/SYN-001', { token: ana, body: { color: 'Azul' } })],
        ['deleted', () => ctx.request('DELETE', '/garage/SYN-001', { token: ana })]
      ] as const) {
        const events = Promise.all([nextEvent(first, 'garage:changed'), nextEvent(second, 'garage:changed')]);
        await run();
        for (const event of await events) assert.deepEqual(event, { action, plate: 'SYN-001' });
      }
      await settle();
      assert.deepEqual(foreign, []);
    });

    it('crear y borrar un diagnóstico sincroniza, y otro usuario no se entera', async () => {
      const mine = client(ana);
      const other = client(luis);
      await Promise.all([connected(mine), connected(other)]);
      const foreign = collect(other, 'diagnosis:changed');

      const creation = nextEvent<{ action: string; id: string; plate: string }>(mine, 'diagnosis:changed');
      const created = await ctx.postForm(`/garage/${PLATE}/diagnoses`, { token: ana, fields: { telltaleId: 'tpms' } });
      assert.deepEqual(await creation, { action: 'created', plate: PLATE, id: created.body.id });

      const removal = nextEvent(mine, 'diagnosis:changed');
      await ctx.request('DELETE', `/garage/${PLATE}/diagnoses/${created.body.id}`, { token: ana });
      assert.deepEqual(await removal, { action: 'deleted', plate: PLATE, id: created.body.id });
      await settle();
      assert.deepEqual(foreign, []);
    });
  });

  describe('progreso del diagnóstico', () => {
    const diagnose = (requestId?: string, image: Uint8Array = JPEG) =>
      fetch(`${ctx.baseUrl}/garage/${PLATE}/diagnoses`, {
        method: 'POST',
        headers: { authorization: `Bearer ${ana}`, ...(requestId ? { 'x-diagnosis-request': requestId } : {}) },
        body: (() => {
          const form = new FormData();
          form.append('image', new Blob([new Uint8Array(image)], { type: 'image/jpeg' }), 'tablero.jpg');
          return form;
        })()
      });

    it('informa cada etapa, y "done" trae la respuesta ya validada', async () => {
      const socket = client(ana);
      await connected(socket);
      const events = collect<{ requestId: string; stage: string; result?: any }>(socket, 'diagnosis:progress');
      // El modelo intenta quitarle gravedad a un testigo de frenos.
      gemini.answer(reading([modelTelltale({ nombre: 'Frenos', categoria: 'frenos', urgencia: 'informativo' })]));

      const requestId = randomUUID();
      const response = await diagnose(requestId);
      const body = (await response.json()) as { urgenciaGeneral: string };
      await settle();

      assert.deepEqual(
        events.map((event) => event.stage),
        ['queued', 'analyzing', 'drafting', 'done']
      );
      assert.ok(events.every((event) => event.requestId === requestId));
      const final = events.at(-1)!.result;
      assert.equal(final.urgenciaGeneral, 'rojo');
      assert.equal(final.debeDetenerse, true);
      assert.equal(final.testigos[0].urgencia, 'rojo');
      assert.equal(body.urgenciaGeneral, 'rojo', 'HTTP entrega lo mismo');
    });

    it('sin id de solicitud, o con uno inválido, no emite progreso pero responde igual', async () => {
      const socket = client(ana);
      await connected(socket);
      const events = collect(socket, 'diagnosis:progress');
      assert.equal((await diagnose()).status, 201);
      assert.equal((await diagnose('no-es-uuid')).status, 201);
      await settle();
      assert.deepEqual(events, []);
    });

    it('una falla del proveedor se informa como failed, y otro usuario no ve nada', async () => {
      const mine = client(ana);
      const other = client(luis);
      await Promise.all([connected(mine), connected(other)]);
      const events = collect<{ stage: string; status?: string }>(mine, 'diagnosis:progress');
      const foreign = collect(other, 'diagnosis:progress');
      const originals = { warn: console.warn, error: console.error };
      console.warn = () => undefined;
      console.error = () => undefined;
      try {
        gemini.status = 429;
        assert.equal((await diagnose(randomUUID())).status, 503);
        gemini.status = 500;
        assert.equal((await diagnose(randomUUID())).status, 503);
      } finally {
        Object.assign(console, originals);
      }
      await settle();
      assert.deepEqual(
        events.filter((event) => event.stage === 'failed').map((event) => event.status),
        ['provider_busy', 'provider_error']
      );
      assert.deepEqual(foreign, []);
    });

    it('una foto sin testigos también termina en done, con su estado', async () => {
      const socket = client(ana);
      await connected(socket);
      const events = collect<{ stage: string; result?: { status: string } }>(socket, 'diagnosis:progress');
      gemini.answer(reading([], { necesitaMejorFoto: true }));
      await diagnose(randomUUID());
      await settle();
      assert.equal(events.at(-1)?.stage, 'done');
      assert.equal(events.at(-1)?.result?.status, 'needs_better_input');
    });
  });

  describe('chat', () => {
    const createBrakes = async () => {
      gemini.answer(reading([modelTelltale({ nombre: 'Frenos', categoria: 'frenos', urgencia: 'rojo' })]));
      const created = await ctx.postForm(`/garage/${PLATE}/diagnoses`, { token: ana, fields: { description: 'luz' } });
      return created.body.id as string;
    };

    it('la respuesta llega ya validada: nunca lo que escribió el modelo si intentó saltarse la seguridad', async () => {
      const id = await createBrakes();
      const first = client(ana);
      const second = client(ana);
      const other = client(luis);
      await Promise.all([connected(first), connected(second), connected(other)]);
      const foreign = collect(other, 'chat:message');

      const event = nextEvent<any>(second, 'chat:message');
      gemini.answer({
        respuesta: 'Tranquilo, puedes seguir manejando hasta tu casa.',
        sugiereSeguirManejando: true,
        temaAjeno: false
      });
      const response = await ctx.request('POST', `/garage/${PLATE}/diagnoses/${id}/messages`, {
        token: ana,
        body: { message: '¿Puedo seguir?' }
      });
      const payload = await event;

      assert.equal(payload.diagnosisId, id);
      assert.equal(payload.question.content, '¿Puedo seguir?');
      assert.ok(payload.answer.content.includes(CHAT_SAFE_STOP_ANSWER));
      assert.doesNotMatch(payload.answer.content, /Tranquilo|puedes seguir manejando/i);
      assert.deepEqual(payload.answer, response.body.answer);
      await settle();
      assert.deepEqual(foreign, []);
    });

    it('si el modelo falla no se emite nada', async () => {
      const id = await createBrakes();
      const socket = client(ana);
      await connected(socket);
      const events = collect(socket, 'chat:message');
      const original = console.error;
      console.error = () => undefined;
      try {
        gemini.status = 500;
        const response = await ctx.request('POST', `/garage/${PLATE}/diagnoses/${id}/messages`, {
          token: ana,
          body: { message: 'hola' }
        });
        assert.equal(response.status, 503);
      } finally {
        console.error = original;
      }
      await settle();
      assert.deepEqual(events, []);
    });
  });

  describe('fin de la sesión', () => {
    it('un token vencido cierra el socket, avisando antes para que el cliente lo renueve', async () => {
      const expiring = await startTestApp();
      try {
        const token = await expiring.registerVerified('socket.vence@example.com');
        const original = expiring.tokens.accessTokenExpiresAt.bind(expiring.tokens);
        expiring.tokens.accessTokenExpiresAt = () => Date.now() + 30;
        const socket = io(expiring.baseUrl, { auth: { token }, reconnection: false, forceNew: true });
        open.push(socket);
        const notice = nextEvent(socket, 'session:expired');
        const closed = nextEvent<string>(socket, 'disconnect');
        await connected(socket);
        await notice;
        assert.equal(await closed, 'io server disconnect');
        expiring.tokens.accessTokenExpiresAt = original;
      } finally {
        await expiring.close();
      }
    });

    it('accessTokenExpiresAt devuelve cuándo vence, y 0 si no se puede leer', () => {
      const token = ctx.tokens.signAccessToken({ id: randomUUID(), email: 'a@b.co', role: 'user' });
      assert.ok(ctx.tokens.accessTokenExpiresAt(token) > Date.now());
      assert.equal(ctx.tokens.accessTokenExpiresAt('basura'), 0);
    });

    it('disconnectUser cierra todas sus conexiones, y no las de otro', async () => {
      const mine = client(ana);
      const other = client(luis);
      await Promise.all([connected(mine), connected(other)]);
      const user = (await ctx.users.findByEmail('socket.ana@example.com'))!;
      const closed = nextEvent(mine, 'disconnect');
      ctx.hub.disconnectUser(user.id);
      await closed;
      assert.equal(other.connected, true);
    });
  });

  it('HTTP sigue funcionando sin ningún socket conectado', async () => {
    assert.equal((await ctx.request('GET', '/garage', { token: ana })).status, 200);
    assert.equal(
      (await ctx.postForm(`/garage/${PLATE}/diagnoses`, { token: ana, fields: { description: 'luz' } })).status,
      201
    );
  });

  it('borrar la cuenta cierra sus sockets', async () => {
    const token = await ctx.registerVerified('socket.borrar@example.com');
    const socket = client(token);
    await connected(socket);
    const closed = nextEvent<string>(socket, 'disconnect');
    assert.equal((await ctx.request('DELETE', '/auth/me', { token, body: { password: DEFAULT_CLAVE } })).status, 204);
    assert.equal(await closed, 'io server disconnect');
  });
});

describe('nonRejecting', () => {
  const client = {
    calls: 0,
    publish() {
      this.calls++;
      return Promise.reject(new Error('redis caído'));
    },
    explode() {
      throw new Error('falla síncrona');
    },
    other() {
      return Promise.reject(new Error('este sí rechaza'));
    },
    label: 'valor'
  };

  it('un publish que rechaza no rechaza: sin esto, Redis caído terminaría el proceso', async () => {
    const safe = nonRejecting(client, ['publish', 'explode']);
    assert.equal(await safe.publish(), undefined);
    assert.equal(client.calls, 1, 'conserva this y sí llama al original');
    await (safe.explode() as unknown as Promise<void>);
  });

  it('los demás métodos y propiedades no cambian', async () => {
    const safe = nonRejecting(client, ['publish']);
    assert.equal(safe.label, 'valor');
    await assert.rejects(safe.other());
  });
});

describe('Sin tiempo real', () => {
  it('noRealtime no hace nada ni falla', () => {
    noRealtime.emit('u', 'garage:changed', { action: 'created', plate: PLATE });
    noRealtime.disconnectUser('u');
  });

  it('emitir antes de unirse al servidor HTTP tampoco falla', async () => {
    const { SocketHub } = await import('../src/services/realtime.js');
    const ctx = await startTestApp();
    try {
      const hub = new SocketHub({ tokens: ctx.tokens, users: ctx.users, corsOrigins: [] });
      hub.emit('u', 'garage:changed', { action: 'created', plate: PLATE });
      hub.disconnectUser('u');
      await hub.close();
    } finally {
      await ctx.close();
    }
  });
});
