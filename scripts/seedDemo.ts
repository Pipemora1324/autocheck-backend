// Siembra la cuenta de demostración: npm run seed:demo -- [--reset | --remove] --yes
// Lee DATABASE_URL, DEMO_USER_EMAIL y DEMO_USER_PASSWORD del entorno (ver README, "Cuenta de demostración").
// Solo imprime el host de la base y conteos: nunca la URL, el correo, la contraseña ni su hash.
//
// Los diagnósticos se crean con el DiagnosisService real y un identificador guionado (sin Gemini y sin imágenes),
// así pasan por el mismo piso de seguridad y se guardan en el mismo formato que los de la aplicación.
// El chat se crea con el DiagnosisChatService real: las respuestas escritas a mano reciben el mismo recordatorio y aviso.
import { readdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { z } from 'zod';
import { findTelltale, type Telltale, type TelltaleSeverity } from '../src/data/telltales.js';
import { createPool } from '../src/db/pool.js';
import { errorMessage } from '../src/errors/httpError.js';
import { PgDiagnosisRepository } from '../src/repositories/pgDiagnosisRepository.js';
import { PgGarageRepository } from '../src/repositories/pgGarageRepository.js';
import { cacheKeys, ResilientCache } from '../src/services/cache.js';
import { DiagnosisChatService, type ChatResponder } from '../src/services/diagnosisChat.js';
import {
  composeFromCatalog,
  DiagnosisService,
  type DiagnosedView,
  type DiagnosisInput
} from '../src/services/diagnosisService.js';
import { GarageService } from '../src/services/garageService.js';
import { Argon2PasswordHasher, type PasswordHasher } from '../src/services/passwordHasher.js';
import { PRIVACY_POLICY_VERSION } from '../src/services/privacyPolicy.js';
import { RedisConnection } from '../src/services/redis.js';
import {
  dashboardReadingSchema,
  type DashboardReading,
  type TelltaleIdentifier
} from '../src/services/telltaleIdentifier.js';
import { createGarageVehicleSchema } from '../src/validation/garageSchemas.js';
import { emailSchema, newPasswordSchema } from '../src/validation/schemas.js';
import {
  DEMO_DIAGNOSES,
  DEMO_VEHICLES,
  type DemoAiDiagnosis,
  type DemoDiagnosis,
  type DemoVehicle
} from './demoData.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));
const SEED_LOCK = 'autocheck:seed-demo';
/** Colombia no tiene horario de verano: siempre UTC-5. */
const COLOMBIA_UTC_OFFSET_HOURS = 5;
const REDIS_WAIT_MS = 5_000;

/** Error esperado: se imprime solo su mensaje, que nunca incluye valores del entorno. */
export class SeedError extends Error {}

export type SeedMode = 'seed' | 'reset' | 'remove';

export interface SeedArgs {
  mode: SeedMode;
  yes: boolean;
}

export function parseArgs(argv: readonly string[]): SeedArgs {
  let reset = false;
  let remove = false;
  let yes = false;
  for (const arg of argv) {
    if (arg === '--reset') reset = true;
    else if (arg === '--remove') remove = true;
    else if (arg === '--yes') yes = true;
    // No se repite el valor: podría ser una contraseña pegada por error.
    else throw new SeedError('Opción desconocida. Usa solo --reset, --remove y --yes.');
  }
  if (reset && remove) throw new SeedError('Usa --reset o --remove, no los dos.');
  return { mode: remove ? 'remove' : reset ? 'reset' : 'seed', yes };
}

export interface DemoCredentials {
  email: string;
  password: string;
}

const splitList = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

/** Valida con la misma política del registro. Los mensajes de error nunca incluyen el valor recibido. */
export function readCredentials(env: NodeJS.ProcessEnv, mode: SeedMode): DemoCredentials {
  const email = emailSchema.safeParse(env.DEMO_USER_EMAIL);
  if (!email.success) throw new SeedError(`DEMO_USER_EMAIL: ${email.error.issues[0]?.message ?? 'no es válido.'}`);
  if (mode === 'remove') return { email: email.data, password: '' };

  const password = newPasswordSchema.safeParse(env.DEMO_USER_PASSWORD);
  if (!password.success)
    throw new SeedError(`DEMO_USER_PASSWORD: ${password.error.issues[0]?.message ?? 'no es válida.'}`);
  // Un correo de ADMIN_EMAILS recibe rol admin al iniciar sesión: la cuenta demo debe quedarse en 'user'.
  if (splitList(env.ADMIN_EMAILS).includes(email.data))
    throw new SeedError('DEMO_USER_EMAIL está en ADMIN_EMAILS: la cuenta demo debe tener rol user.');
  return { email: email.data, password: password.data };
}

/** Solo el nombre del host: sin usuario, contraseña, puerto ni parámetros. */
export function databaseHost(databaseUrl: string | undefined): string {
  const parsed = z.url({ protocol: /^postgres(ql)?$/ }).safeParse(databaseUrl);
  if (!parsed.success) throw new SeedError('DATABASE_URL no está definida o no es una URL postgres:// válida.');
  return new URL(parsed.data).hostname;
}

interface Queryable {
  query<R extends pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>>;
}

export function repoMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .map((file) => file.slice(0, -'.sql'.length))
    .sort();
}

/** Aborta si la base no tiene exactamente las migraciones de este repositorio. */
export async function checkMigrations(db: Queryable): Promise<void> {
  let applied: string[];
  try {
    applied = (await db.query<{ name: string }>('SELECT name FROM pgmigrations')).rows.map((row) => row.name);
  } catch (error) {
    if ((error as { code?: string }).code === '42P01')
      throw new SeedError('La base no tiene la tabla pgmigrations: ejecuta primero las migraciones.');
    throw error;
  }
  const expected = repoMigrations();
  const missing = expected.filter((name) => !applied.includes(name));
  const unknown = applied.filter((name) => !expected.includes(name));
  if (missing.length > 0 || unknown.length > 0) {
    const details = [
      missing.length > 0 ? `faltan en la base: ${missing.join(', ')}` : '',
      unknown.length > 0 ? `solo están en la base: ${unknown.join(', ')}` : ''
    ].filter(Boolean);
    throw new SeedError(
      `Las migraciones de la base no coinciden con las del repositorio (${details.join('; ')}). No se escribió nada.`
    );
  }
}

/** Fecha en hora de Colombia, daysAgo días antes de now. */
export function demoTimestamp(now: Date, daysAgo: number, hour: number, minute: number): Date {
  const local = new Date(now.getTime() - COLOMBIA_UTC_OFFSET_HOURS * 3_600_000);
  return new Date(
    Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate() - daysAgo,
      hour + COLOMBIA_UTC_OFFSET_HOURS,
      minute
    )
  );
}

function catalogTelltale(id: string): Telltale {
  const telltale = findTelltale(id);
  if (!telltale) throw new SeedError(`El testigo ${id} de los datos de demostración no está en el catálogo.`);
  return telltale;
}

/** La lectura que habría devuelto el modelo, validada con el mismo esquema que la respuesta real de Gemini. */
export function readingFor(diagnosis: DemoAiDiagnosis): DashboardReading {
  return dashboardReadingSchema.parse({
    testigos: diagnosis.testigos.map((item) => {
      const telltale = catalogTelltale(item.telltaleId);
      return {
        nombre: telltale.nombre,
        descripcionSimbolo: telltale.descripcionSimbolo,
        color: item.color,
        parpadeando: item.parpadeando ?? null,
        categoria: composeFromCatalog(telltale).categoria,
        urgencia: telltale.severidad,
        significado: telltale.significado,
        porQuePasa: telltale.causasProbables,
        puedesRevisar: telltale.puedesRevisar,
        noHagas: telltale.noHagas,
        cuandoIrAlMecanico: telltale.cuandoIrAlMecanico,
        notaDelVehiculo: item.nota ?? null,
        confianza: item.confianza
      };
    }),
    mensajeGeneral: diagnosis.mensajeGeneral,
    necesitaMejorFoto: false,
    motivoMejorFoto: null
  });
}

const scriptedIdentifier = (reading: DashboardReading): TelltaleIdentifier => ({
  provider: 'gemini',
  identify: () => Promise.resolve(reading)
});

const scriptedResponder = (answer: string): ChatResponder => ({
  reply: () => Promise.resolve({ respuesta: answer, sugiereSeguirManejando: false, temaAjeno: false })
});

function inputFor(diagnosis: DemoDiagnosis): DiagnosisInput {
  const blinking = diagnosis.blinking === undefined ? {} : { blinking: diagnosis.blinking };
  const description = diagnosis.description ? { description: diagnosis.description } : {};
  return diagnosis.kind === 'manual'
    ? { telltaleId: diagnosis.telltaleId, ...blinking, ...description }
    : { ...blinking, ...description };
}

export type SeverityCounts = Record<TelltaleSeverity, number>;

export interface SeedSummary {
  mode: SeedMode;
  account: 'creada' | 'actualizada' | 'recreada' | 'eliminada' | 'no existía';
  vehicles: number;
  diagnoses: number;
  bySeverity: SeverityCounts;
  conversations: number;
  messages: number;
  /** Para invalidar la caché de esas cuentas. No se imprimen. */
  userIds: string[];
}

export interface SeedInput extends DemoCredentials {
  mode: SeedMode;
  now?: Date;
  hasher?: PasswordHasher;
}

const emptyCounts = (): SeverityCounts => ({ rojo: 0, amarillo: 0, informativo: 0 });

async function countUserData(client: pg.PoolClient, userId: string) {
  const { rows } = await client.query<{ vehicles: number; conversations: number; messages: number }>(
    `SELECT (SELECT count(*) FROM user_vehicles WHERE user_id = $1)::int AS vehicles,
            (SELECT count(DISTINCT m.diagnosis_id) FROM diagnosis_messages m JOIN diagnoses d ON d.id = m.diagnosis_id
              WHERE d.user_id = $1)::int AS conversations,
            (SELECT count(*) FROM diagnosis_messages m JOIN diagnoses d ON d.id = m.diagnosis_id
              WHERE d.user_id = $1)::int AS messages`,
    [userId]
  );
  const severities = await client.query<{ severidad: TelltaleSeverity; total: number }>(
    'SELECT severidad, count(*)::int AS total FROM diagnoses WHERE user_id = $1 GROUP BY severidad',
    [userId]
  );
  const bySeverity = emptyCounts();
  for (const row of severities.rows) bySeverity[row.severidad] = row.total;
  const counts = rows[0] ?? { vehicles: 0, conversations: 0, messages: 0 };
  return { ...counts, bySeverity, diagnoses: bySeverity.rojo + bySeverity.amarillo + bySeverity.informativo };
}

/** Crea o actualiza el usuario demo. Devuelve su id y qué pasó con la cuenta. */
async function upsertDemoUser(
  client: pg.PoolClient,
  existing: { id: string } | undefined,
  { email, passwordHash, now }: { email: string; passwordHash: string; now: Date }
): Promise<string> {
  if (existing) {
    await client.query(
      `UPDATE users SET password_hash = $2, role = 'user', email_verified_at = $3, terms_accepted_at = $3, terms_version = $4
       WHERE id = $1`,
      [existing.id, passwordHash, now, PRIVACY_POLICY_VERSION]
    );
    return existing.id;
  }
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, role, email_verified_at, terms_accepted_at, terms_version, created_at)
     VALUES ($1, $2, 'user', $3, $3, $4, $5)
     RETURNING id`,
    [email, passwordHash, now, PRIVACY_POLICY_VERSION, demoTimestamp(now, 90, 7, 30)]
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('INSERT no devolvió el usuario demo.');
  return id;
}

function vehicleData(vehicle: DemoVehicle) {
  // El mismo validador que POST /garage: normaliza la placa y rechaza datos fuera de rango.
  const { plate, source, ...data } = createGarageVehicleSchema.parse({
    plate: vehicle.plate,
    brand: vehicle.brand,
    model: vehicle.model,
    year: vehicle.year,
    color: vehicle.color,
    cylinderCc: vehicle.cylinderCc,
    chassis: null,
    fuelType: vehicle.fuelType,
    serviceType: 'Particular',
    mileageKm: vehicle.mileageKm,
    source: 'manual'
  });
  return { plate, source, data };
}

async function createDemoData(client: pg.PoolClient, userId: string, now: Date) {
  // Los repositorios solo usan query(): con el cliente de la transacción, todo se escribe dentro de ella.
  const db = client as unknown as pg.Pool;
  const garageRepository = new PgGarageRepository(db);
  const diagnosisRepository = new PgDiagnosisRepository(db);
  const garage = new GarageService(garageRepository);

  for (const vehicle of DEMO_VEHICLES) {
    const { plate, source, data } = vehicleData(vehicle);
    await garage.create(userId, plate, data, source);
    const addedAt = demoTimestamp(now, vehicle.addedDaysAgo, 9, 0);
    await client.query('UPDATE user_vehicles SET created_at = $3, updated_at = $3 WHERE user_id = $1 AND plate = $2', [
      userId,
      plate,
      addedAt
    ]);
  }

  const bySeverity = emptyCounts();
  let conversations = 0;
  let messages = 0;
  for (const diagnosis of DEMO_DIAGNOSES) {
    const identifier = diagnosis.kind === 'ia' ? scriptedIdentifier(readingFor(diagnosis)) : null;
    const result = await new DiagnosisService(garageRepository, diagnosisRepository, identifier).diagnose(
      userId,
      diagnosis.plate,
      inputFor(diagnosis)
    );
    if (result.status !== 'diagnosed')
      throw new SeedError(`Un diagnóstico de ${diagnosis.plate} no quedó guardado (${result.status}).`);
    const createdAt = demoTimestamp(now, diagnosis.daysAgo, diagnosis.hour, diagnosis.minute);
    await client.query('UPDATE diagnoses SET created_at = $2 WHERE id = $1', [result.id, createdAt]);
    bySeverity[result.urgenciaGeneral] += 1;

    if (diagnosis.chat) {
      messages += await createChat(client, garageRepository, diagnosisRepository, userId, diagnosis, result, createdAt);
      conversations += 1;
    }
  }
  return {
    vehicles: DEMO_VEHICLES.length,
    diagnoses: DEMO_DIAGNOSES.length,
    bySeverity,
    conversations,
    messages
  };
}

async function createChat(
  client: pg.PoolClient,
  garageRepository: PgGarageRepository,
  diagnosisRepository: PgDiagnosisRepository,
  userId: string,
  diagnosis: DemoDiagnosis,
  result: DiagnosedView,
  createdAt: Date
): Promise<number> {
  let saved = 0;
  for (const [index, turn] of (diagnosis.chat ?? []).entries()) {
    const chat = new DiagnosisChatService(garageRepository, diagnosisRepository, scriptedResponder(turn.answer));
    const { question, answer } = await chat.send(userId, diagnosis.plate, result.id, turn.question);
    // Si el piso del chat la reemplazó, el texto de demostración sugiere seguir manejando: hay que corregirlo.
    if (!answer.content.startsWith(turn.answer))
      throw new SeedError(`Una respuesta del chat de ${diagnosis.plate} no pasó el piso de seguridad.`);
    const askedAt = new Date(createdAt.getTime() + (index * 3 + 2) * 60_000);
    await client.query('UPDATE diagnosis_messages SET created_at = $2 WHERE id = $1', [question.id, askedAt]);
    await client.query('UPDATE diagnosis_messages SET created_at = $2 WHERE id = $1', [
      answer.id,
      new Date(askedAt.getTime() + 40_000)
    ]);
    saved += 2;
  }
  return saved;
}

/** Todo en una transacción y solo sobre la cuenta demo: si algo falla, la base queda como estaba. */
export async function seedDemo(pool: pg.Pool, input: SeedInput): Promise<SeedSummary> {
  const now = input.now ?? new Date();
  const passwordHash =
    input.mode === 'remove' ? '' : await (input.hasher ?? new Argon2PasswordHasher()).hash(input.password);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Dos ejecuciones a la vez no se mezclan.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [SEED_LOCK]);
    await checkMigrations(client);
    const summary = await seedInTransaction(client, { ...input, now, passwordHash });
    await client.query('COMMIT');
    return summary;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function seedInTransaction(
  client: pg.PoolClient,
  { email, mode, now, passwordHash }: { email: string; mode: SeedMode; now: Date; passwordHash: string }
): Promise<SeedSummary> {
  const found = await client.query<{ id: string; role: string }>(
    'SELECT id, role FROM users WHERE email = $1 FOR UPDATE',
    [email]
  );
  const existing = found.rows.at(0);
  if (existing?.role === 'admin')
    throw new SeedError('El correo de demostración es de una cuenta admin: no se modificó nada.');

  if (mode === 'remove') {
    if (!existing)
      return {
        mode,
        account: 'no existía',
        vehicles: 0,
        diagnoses: 0,
        bySeverity: emptyCounts(),
        conversations: 0,
        messages: 0,
        userIds: []
      };
    const counts = await countUserData(client, existing.id);
    // ON DELETE CASCADE borra vehículos, diagnósticos, mensajes, sesiones y tokens de la cuenta.
    await client.query('DELETE FROM users WHERE id = $1', [existing.id]);
    return { mode, account: 'eliminada', ...counts, userIds: [existing.id] };
  }

  const userIds: string[] = [];
  let keep = existing;
  if (existing && mode === 'reset') {
    await client.query('DELETE FROM users WHERE id = $1', [existing.id]);
    userIds.push(existing.id);
    keep = undefined;
  } else if (existing) {
    // Sin --reset solo se reemplazan los vehículos de demostración; lo demás de la cuenta se conserva.
    await client.query('DELETE FROM user_vehicles WHERE user_id = $1 AND plate = ANY($2)', [
      existing.id,
      DEMO_VEHICLES.map((vehicle) => vehicleData(vehicle).plate)
    ]);
  }
  const userId = await upsertDemoUser(client, keep, { email, passwordHash, now });
  if (!userIds.includes(userId)) userIds.push(userId);
  const created = await createDemoData(client, userId, now);
  const account = !existing ? 'creada' : mode === 'reset' ? 'recreada' : 'actualizada';
  return { mode, account, ...created, userIds };
}

/** Las listas del garaje y del historial se guardan 60 s en caché: se borran para que se vean los datos nuevos. */
async function invalidateCache(redisUrl: string | undefined, userIds: string[]): Promise<void> {
  if (!redisUrl?.trim() || userIds.length === 0) return;
  const redis = new RedisConnection(redisUrl.trim());
  try {
    const ready = await Promise.race([
      new Promise<boolean>((resolve) => {
        redis.onFirstReady(() => {
          resolve(true);
        });
      }),
      sleep(REDIS_WAIT_MS, false, { ref: false })
    ]);
    if (!ready) {
      console.warn('Redis no respondió: las listas en caché se renuevan solas en un minuto.');
      return;
    }
    const cache = new ResilientCache(redis);
    for (const userId of userIds) await cache.deleteByPrefix(cacheKeys.userPrefix(userId));
    console.log('Caché de la cuenta demo invalidada.');
  } finally {
    await redis.close();
  }
}

const MODE_LABEL: Record<SeedMode, string> = {
  seed: 'crear o actualizar la cuenta demo y sus datos',
  reset: 'borrar la cuenta demo y volver a crearla (--reset)',
  remove: 'eliminar la cuenta demo y todo lo suyo (--remove)'
};

export function formatSummary(summary: SeedSummary): string[] {
  const { rojo, amarillo, informativo } = summary.bySeverity;
  const verb = summary.mode === 'remove' ? 'Eliminados' : 'Sembrados';
  return [
    `Listo: cuenta demo ${summary.account}.`,
    `  ${verb}: ${summary.vehicles} vehículos, ${summary.diagnoses} diagnósticos ` +
      `(${rojo} rojos, ${amarillo} amarillos, ${informativo} informativos), ` +
      `${summary.conversations} conversaciones con ${summary.messages} mensajes.`
  ];
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const host = databaseHost(process.env.DATABASE_URL);
  const credentials = readCredentials(process.env, args.mode);
  console.log(`Base de datos: ${host}`);
  console.log(`Acción: ${MODE_LABEL[args.mode]}`);

  const pool = createPool(process.env.DATABASE_URL ?? '');
  try {
    await checkMigrations(pool);
    console.log('Migraciones: la base coincide con el repositorio.');
    if (!args.yes) {
      console.log('No se escribió nada. Revisa el host y vuelve a ejecutar con --yes.');
      return 1;
    }
    const summary = await seedDemo(pool, { ...credentials, mode: args.mode });
    for (const line of formatSummary(summary)) console.log(line);
    await invalidateCache(process.env.REDIS_URL, summary.userIds);
    return 0;
  } finally {
    await pool.end();
  }
}

const isEntryPoint = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isEntryPoint) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(error instanceof SeedError ? error.message : `Error: ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}
