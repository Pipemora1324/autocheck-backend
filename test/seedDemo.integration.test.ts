import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { after, before, beforeEach, describe, it } from 'node:test';
import pg from 'pg';
import { DEMO_DIAGNOSES, DEMO_VEHICLES } from '../scripts/demoData.js';
import { seedDemo, SeedError, type SeedInput } from '../scripts/seedDemo.js';
import { createApp } from '../src/app.js';
import { runMigrations } from '../src/db/migrate.js';
import { createPool } from '../src/db/pool.js';
import {
  applySafetyFloor,
  DIAGNOSIS_DISCLAIMER,
  NEVER_DRIVE_ACTION,
  suggestsDriving,
  worstUrgency,
  type FinalTelltale
} from '../src/domain/diagnosisSafety.js';
import {
  PgEmailVerificationTokenRepository,
  PgPasswordResetTokenRepository,
  PgRefreshTokenRepository,
  PgUserRepository
} from '../src/repositories/pgAuthRepositories.js';
import { PgDiagnosisRepository } from '../src/repositories/pgDiagnosisRepository.js';
import { PgGarageRepository } from '../src/repositories/pgGarageRepository.js';
import { AuthService } from '../src/services/authService.js';
import { CardScanService } from '../src/services/cardScanService.js';
import { CHAT_SAFE_STOP_ANSWER, CHAT_STOP_REMINDER, DiagnosisChatService } from '../src/services/diagnosisChat.js';
import { DiagnosisService } from '../src/services/diagnosisService.js';
import { GarageService } from '../src/services/garageService.js';
import { Argon2PasswordHasher } from '../src/services/passwordHasher.js';
import { PRIVACY_POLICY_VERSION } from '../src/services/privacyPolicy.js';
import { TokenService } from '../src/services/tokenService.js';
import { newUser } from './support/fixtures.js';
import { NO_RATE_LIMITS } from './support/testApp.js';

// Usa una base propia (<TEST_DATABASE_URL>_seed_demo) para no chocar con postgres.integration.test.ts, que corre en paralelo.
const baseUrl = process.env.TEST_DATABASE_URL;
const skip = !baseUrl
  ? 'TEST_DATABASE_URL no definida'
  : !new URL(baseUrl).pathname.includes('test')
    ? 'TEST_DATABASE_URL debe apuntar a una base cuyo nombre contenga "test"'
    : false;

// Valores obviamente falsos, generados en cada corrida.
const DEMO_EMAIL = 'demo.falsa@example.test';
const FAKE_CLAVE = `falsa-${randomBytes(6).toString('hex')}`;
const OTHER_EMAIL = 'otra.persona@example.test';
const STOP_CATEGORIES = new Set(['aceite', 'temperatura', 'frenos', 'direccion', 'bateria_carga']);
const MESSAGES_IN_DATA = DEMO_DIAGNOSES.reduce((total, item) => total + (item.chat?.length ?? 0) * 2, 0);

interface Api {
  get(path: string, token: string): Promise<{ status: number; body: any }>;
  login(email: string, clave: string): Promise<{ status: number; body: any }>;
  close(): Promise<void>;
}

/** La misma API que server.ts, con los repositorios Postgres y sin IA. */
async function startApi(pool: pg.Pool): Promise<Api> {
  const users = new PgUserRepository(pool);
  const tokens = new TokenService(randomBytes(32).toString('hex'), randomBytes(32).toString('hex'));
  const garage = new PgGarageRepository(pool);
  const diagnoses = new PgDiagnosisRepository(pool);
  const authService = new AuthService({
    users,
    resetTokens: new PgPasswordResetTokenRepository(pool),
    verificationTokens: new PgEmailVerificationTokenRepository(pool),
    refreshTokens: new PgRefreshTokenRepository(pool),
    hasher: new Argon2PasswordHasher(),
    tokens,
    mailer: { sendPasswordReset: async () => undefined, sendEmailVerification: async () => undefined },
    adminEmails: [],
    appUrl: 'http://localhost:4200'
  });
  const app = createApp({
    config: {
      isProduction: false,
      nodeEnv: 'test',
      corsOrigins: ['http://localhost:4200'],
      cookie: { path: '/auth', sameSite: 'lax', secure: false },
      trustProxy: 0
    },
    authService,
    garageService: new GarageService(garage),
    cardScanService: new CardScanService(null),
    diagnosisService: new DiagnosisService(garage, diagnoses, null),
    diagnosisChatService: new DiagnosisChatService(garage, diagnoses, null),
    tokenService: tokens,
    users,
    rateLimits: NO_RATE_LIMITS
  });
  const server: Server = await new Promise((resolve) => {
    const listening = app.listen(0, () => {
      resolve(listening);
    });
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, init: { token?: string; body?: unknown } = {}) => {
    const response = await fetch(url + path, {
      method,
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(init.token ? { authorization: `Bearer ${init.token}` } : {})
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {})
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
  return {
    get: (path, token) => call('GET', path, { token }),
    login: (email, clave) => call('POST', '/auth/login', { body: { email, password: clave } }),
    close: () =>
      new Promise((resolve) => {
        server.close(() => {
          resolve();
        });
      })
  };
}

describe('seed:demo contra Postgres (integración)', { skip }, () => {
  let admin: pg.Pool;
  let pool: pg.Pool;
  let databaseUrl: string;
  const seedInput = (mode: SeedInput['mode'] = 'seed'): SeedInput => ({
    email: DEMO_EMAIL,
    password: FAKE_CLAVE,
    mode
  });

  const count = async (sql: string, values: unknown[] = []) =>
    (await pool.query<{ total: number }>(sql, values)).rows[0].total;
  const demoUserId = async () =>
    (await pool.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [DEMO_EMAIL])).rows[0]?.id;
  const snapshotOf = async (userId: string) =>
    (
      await pool.query(
        `SELECT v.plate, v.brand, v.model, v.updated_at, d.id AS diagnosis, d.resultado, d.created_at,
                (SELECT json_agg(m.content ORDER BY m.created_at) FROM diagnosis_messages m WHERE m.diagnosis_id = d.id) AS chat
         FROM user_vehicles v LEFT JOIN diagnoses d ON d.vehicle_id = v.id
         WHERE v.user_id = $1 ORDER BY v.plate, d.id`,
        [userId]
      )
    ).rows;

  /** Otra cuenta con la misma placa DEM-101 que la cuenta demo, un diagnóstico y un chat. */
  async function createOtherUser(): Promise<string> {
    const other = (await new PgUserRepository(pool).create(newUser(OTHER_EMAIL)))!;
    const vehicle = (await new PgGarageRepository(pool).create(other.id, {
      plate: 'DEM-101',
      brand: 'Otra',
      model: 'Persona',
      year: 2015,
      color: null,
      cylinderCc: null,
      chassis: null,
      fuelType: 'Gasolina',
      serviceType: null,
      mileageKm: null,
      source: 'manual'
    }))!;
    const diagnoses = new PgDiagnosisRepository(pool);
    const record = await diagnoses.create({
      userId: other.id,
      vehicleId: vehicle.id,
      telltaleId: 'abs',
      severidad: 'amarillo',
      confianza: null,
      descripcion: 'de otra persona',
      resultado: null
    });
    await diagnoses.addExchange(record.id, 'pregunta ajena', 'respuesta ajena');
    return other.id;
  }

  before(async () => {
    const url = new URL(baseUrl!);
    const name = `${url.pathname.slice(1)}_seed_demo`;
    admin = createPool(baseUrl!);
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${name}"`);
    url.pathname = `/${name}`;
    databaseUrl = url.toString();
    await runMigrations(databaseUrl);
    pool = createPool(databaseUrl);
  });

  after(async () => {
    await pool.end();
    await admin.query(`DROP DATABASE IF EXISTS "${new URL(databaseUrl).pathname.slice(1)}" WITH (FORCE)`);
    await admin.end();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM users');
  });

  it('crea la cuenta verificada, con consentimiento vigente, rol user y la contraseña hasheada con argon2id', async () => {
    const summary = await seedDemo(pool, seedInput());
    assert.equal(summary.account, 'creada');
    assert.equal(summary.vehicles, DEMO_VEHICLES.length);
    assert.equal(summary.diagnoses, DEMO_DIAGNOSES.length);
    assert.equal(summary.messages, MESSAGES_IN_DATA);

    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [DEMO_EMAIL]);
    const user = rows[0];
    assert.equal(user.role, 'user');
    assert.ok(user.email_verified_at instanceof Date);
    assert.ok(Date.now() - user.email_verified_at.getTime() < 60_000);
    assert.ok(user.terms_accepted_at instanceof Date);
    assert.equal(user.terms_version, PRIVACY_POLICY_VERSION);
    assert.match(user.password_hash, /^\$argon2id\$/);
    assert.ok(!user.password_hash.includes(FAKE_CLAVE));
    assert.ok(await new Argon2PasswordHasher().verify(user.password_hash, FAKE_CLAVE));
  });

  it('es idempotente: correrlo de nuevo deja los mismos datos, sin duplicados', async () => {
    await seedDemo(pool, seedInput());
    const first = await demoUserId();
    const totals = async () => ({
      users: await count('SELECT count(*)::int AS total FROM users WHERE email = $1', [DEMO_EMAIL]),
      vehicles: await count('SELECT count(*)::int AS total FROM user_vehicles'),
      diagnoses: await count('SELECT count(*)::int AS total FROM diagnoses'),
      messages: await count('SELECT count(*)::int AS total FROM diagnosis_messages')
    });
    const before = await totals();

    const again = await seedDemo(pool, seedInput());
    assert.equal(again.account, 'actualizada');
    assert.deepEqual(await totals(), before);
    assert.deepEqual(before, {
      users: 1,
      vehicles: DEMO_VEHICLES.length,
      diagnoses: DEMO_DIAGNOSES.length,
      messages: MESSAGES_IN_DATA
    });
    assert.equal(await demoUserId(), first, 'sin --reset se conserva la misma cuenta');
  });

  it('sin --reset conserva lo que el usuario demo agregó; --reset lo borra y recrea la cuenta', async () => {
    await seedDemo(pool, seedInput());
    const userId = await demoUserId();
    await new PgGarageRepository(pool).create(userId, {
      plate: 'XYZ-987',
      brand: 'Agregado',
      model: 'En la demo',
      year: null,
      color: null,
      cylinderCc: null,
      chassis: null,
      fuelType: null,
      serviceType: null,
      mileageKm: null,
      source: 'manual'
    });
    await new PgRefreshTokenRepository(pool).create(
      { id: crypto.randomUUID(), userId, familyId: crypto.randomUUID() },
      new Date(Date.now() + 60_000)
    );

    await seedDemo(pool, seedInput());
    assert.equal(await count('SELECT count(*)::int AS total FROM user_vehicles WHERE user_id = $1', [userId]), 16);

    const reset = await seedDemo(pool, seedInput('reset'));
    assert.equal(reset.account, 'recreada');
    const newId = await demoUserId();
    assert.notEqual(newId, userId);
    assert.ok(reset.userIds.includes(userId) && reset.userIds.includes(newId));
    assert.equal(await count('SELECT count(*)::int AS total FROM user_vehicles WHERE plate = $1', ['XYZ-987']), 0);
    assert.equal(await count('SELECT count(*)::int AS total FROM refresh_tokens WHERE user_id = $1', [userId]), 0);
    assert.equal(
      await count('SELECT count(*)::int AS total FROM user_vehicles WHERE user_id = $1', [newId]),
      DEMO_VEHICLES.length
    );
  });

  it('no toca a otros usuarios, ni siquiera con la misma placa, al sembrar, resetear o eliminar', async () => {
    const otherId = await createOtherUser();
    const before = await snapshotOf(otherId);
    assert.equal(before.length, 1);

    for (const mode of ['seed', 'seed', 'reset', 'remove'] as const) {
      await seedDemo(pool, seedInput(mode));
      assert.deepEqual(await snapshotOf(otherId), before, `después de ${mode}`);
    }
    assert.equal(await count('SELECT count(*)::int AS total FROM users WHERE id = $1', [otherId]), 1);
  });

  it('--remove elimina la cuenta y todo lo suyo; si no existe, no hace nada', async () => {
    await seedDemo(pool, seedInput());
    const removed = await seedDemo(pool, seedInput('remove'));
    assert.equal(removed.account, 'eliminada');
    assert.equal(removed.vehicles, DEMO_VEHICLES.length);
    assert.equal(removed.diagnoses, DEMO_DIAGNOSES.length);
    assert.equal(removed.messages, MESSAGES_IN_DATA);
    for (const table of ['users', 'user_vehicles', 'diagnoses', 'diagnosis_messages'])
      assert.equal(await count(`SELECT count(*)::int AS total FROM ${table}`), 0, table);
    assert.equal((await seedDemo(pool, seedInput('remove'))).account, 'no existía');
  });

  it('no modifica una cuenta admin', async () => {
    await seedDemo(pool, seedInput());
    await pool.query("UPDATE users SET role = 'admin' WHERE email = $1", [DEMO_EMAIL]);
    const before = await snapshotOf(await demoUserId());
    for (const mode of ['seed', 'reset', 'remove'] as const)
      await assert.rejects(seedDemo(pool, seedInput(mode)), SeedError);
    assert.deepEqual(await snapshotOf(await demoUserId()), before);
  });

  it('aborta sin escribir si las migraciones de la base no coinciden con las del repositorio', async () => {
    await pool.query("INSERT INTO pgmigrations (name, run_on) VALUES ('9999999999999_desconocida', now())");
    await assert.rejects(seedDemo(pool, seedInput()), /solo están en la base: 9999999999999_desconocida/);
    await pool.query("DELETE FROM pgmigrations WHERE name = '9999999999999_desconocida'");

    const last = (await pool.query('SELECT * FROM pgmigrations ORDER BY id DESC LIMIT 1')).rows[0];
    await pool.query('DELETE FROM pgmigrations WHERE id = $1', [last.id]);
    await assert.rejects(seedDemo(pool, seedInput()), new RegExp(`faltan en la base: ${last.name}`));
    await pool.query('INSERT INTO pgmigrations (id, name, run_on) VALUES ($1, $2, $3)', [
      last.id,
      last.name,
      last.run_on
    ]);
    assert.equal(await count('SELECT count(*)::int AS total FROM users'), 0);
  });

  it('si algo falla a mitad de camino, la transacción no deja nada a medias', async () => {
    await seedDemo(pool, seedInput());
    const userId = await demoUserId();
    const before = await snapshotOf(userId);
    // Falla al guardar el último chat de los datos (el de la moto). NOT VALID: no revisa las filas que ya existen.
    await pool.query(
      "ALTER TABLE diagnosis_messages ADD CONSTRAINT falla_a_proposito CHECK (content NOT LIKE '%titila%') NOT VALID"
    );
    try {
      await assert.rejects(seedDemo(pool, seedInput()), /falla_a_proposito/);
      await assert.rejects(seedDemo(pool, seedInput('reset')), /falla_a_proposito/);
    } finally {
      await pool.query('ALTER TABLE diagnosis_messages DROP CONSTRAINT falla_a_proposito');
    }
    assert.equal(await demoUserId(), userId);
    assert.deepEqual(await snapshotOf(userId), before);
  });

  it('los endpoints reales leen lo sembrado: garaje, historial, detalle y mensajes', async () => {
    await seedDemo(pool, seedInput());
    const api = await startApi(pool);
    try {
      const login = await api.login(DEMO_EMAIL, FAKE_CLAVE);
      assert.equal(login.status, 200);
      assert.equal(login.body.user.emailVerified, true);
      const token = login.body.accessToken as string;

      const garage = await api.get('/garage', token);
      assert.equal(garage.status, 200);
      assert.equal(garage.body.vehicles.length, DEMO_VEHICLES.length);
      assert.equal(garage.body.vehicles.find((item: any) => item.plate === 'DEM-20M').kind, 'moto');

      let conversations = 0;
      let messages = 0;
      const ninetyDaysAgo = Date.now() - 90 * 86_400_000;
      for (const vehicle of DEMO_VEHICLES) {
        const history = await api.get(`/garage/${vehicle.plate}/diagnoses?limit=50`, token);
        assert.equal(history.status, 200, vehicle.plate);
        const expected = DEMO_DIAGNOSES.filter((item) => item.plate === vehicle.plate);
        assert.equal(history.body.total, expected.length, vehicle.plate);
        const dates = history.body.items.map((item: any) => Date.parse(item.createdAt));
        assert.deepEqual(
          dates,
          [...dates].sort((a, b) => b - a),
          'del más reciente al más antiguo'
        );
        assert.ok(dates.every((date: number) => date > ninetyDaysAgo && date < Date.now()));

        for (const item of history.body.items) {
          const detail = await api.get(`/garage/${vehicle.plate}/diagnoses/${item.id}`, token);
          assert.equal(detail.status, 200);
          assert.equal(detail.body.aviso, DIAGNOSIS_DISCLAIMER);
          assert.equal(detail.body.urgenciaGeneral, item.severidad);
          assert.equal(detail.body.testigos.length, item.totalTestigos);
          assertSafetyFloor(detail.body);

          const chat = await api.get(`/garage/${vehicle.plate}/diagnoses/${item.id}/messages`, token);
          assert.equal(chat.status, 200);
          assertChatSafety(chat.body.messages, detail.body.debeDetenerse);
          if (chat.body.messages.length > 0) {
            conversations += 1;
            messages += Number(chat.body.messages.length);
            assert.ok(chat.body.messages.length >= 2 && chat.body.messages.length <= 6);
            assert.ok(Date.parse(chat.body.messages[0].createdAt) > Date.parse(detail.body.createdAt));
          }
        }
      }
      assert.equal(conversations, DEMO_DIAGNOSES.filter((item) => item.chat).length);
      assert.equal(messages, MESSAGES_IN_DATA);
    } finally {
      await api.close();
    }
  });
});

/** El piso del servidor se cumple en lo guardado: volver a aplicarlo no cambia nada. */
function assertSafetyFloor(result: {
  urgenciaGeneral: string;
  debeDetenerse: boolean;
  accionGeneral: string;
  mensajeGeneral: string;
  testigos: FinalTelltale[];
}) {
  assert.equal(result.urgenciaGeneral, worstUrgency(result.testigos.map((item) => item.urgencia)));
  assert.equal(
    result.debeDetenerse,
    result.testigos.some((item) => item.debeDetenerse)
  );
  if (result.debeDetenerse) assert.equal(result.accionGeneral, NEVER_DRIVE_ACTION);
  assert.equal(suggestsDriving(result.mensajeGeneral), false);
  for (const telltale of result.testigos) {
    if (STOP_CATEGORIES.has(telltale.categoria)) {
      assert.equal(telltale.urgencia, 'rojo', telltale.nombre);
      assert.equal(telltale.debeDetenerse, true, telltale.nombre);
      assert.equal(telltale.accion, NEVER_DRIVE_ACTION, telltale.nombre);
    }
    if (telltale.debeDetenerse) {
      for (const text of [telltale.significado, telltale.cuandoIrAlMecanico, telltale.notaDelVehiculo ?? ''])
        assert.equal(suggestsDriving(text), false, text);
    }
    const again = applySafetyFloor({ ...telltale, urgencia: telltale.urgencia });
    assert.equal(again.urgencia, telltale.urgencia, telltale.nombre);
    assert.equal(again.debeDetenerse, telltale.debeDetenerse, telltale.nombre);
  }
}

function assertChatSafety(messages: Array<{ role: string; content: string }>, mustStop: boolean) {
  for (const [index, message] of messages.entries()) {
    assert.equal(message.role, index % 2 === 0 ? 'user' : 'assistant');
    if (message.role !== 'assistant') continue;
    assert.ok(message.content.endsWith(DIAGNOSIS_DISCLAIMER));
    assert.ok(!message.content.startsWith(CHAT_SAFE_STOP_ANSWER), 'la respuesta escrita a mano no fue reemplazada');
    if (mustStop) {
      assert.ok(message.content.includes(CHAT_STOP_REMINDER));
      assert.equal(suggestsDriving(message.content), false, message.content);
    }
  }
}
