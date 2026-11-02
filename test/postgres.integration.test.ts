import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type pg from 'pg';
import { runMigrations } from '../src/db/migrate.js';
import { createPool } from '../src/db/pool.js';
import {
  PgEmailVerificationTokenRepository,
  PgPasswordResetTokenRepository,
  PgRefreshTokenRepository,
  PgUserRepository
} from '../src/repositories/pgAuthRepositories.js';
import { PgVehicleRepository } from '../src/repositories/pgVehicleRepository.js';
import { hashResetToken } from '../src/services/authService.js';
import { VehicleService } from '../src/services/vehicleService.js';
import { newUser } from './support/fixtures.js';

// Requiere TEST_DATABASE_URL apuntando a una base desechable: se borra el esquema public antes de migrar.
const databaseUrl = process.env.TEST_DATABASE_URL;
const skip = !databaseUrl
  ? 'TEST_DATABASE_URL no definida'
  : !new URL(databaseUrl).pathname.includes('test')
    ? 'TEST_DATABASE_URL debe apuntar a una base cuyo nombre contenga "test"'
    : false;

describe('Repositorios Postgres (integración)', { skip }, () => {
  let pool: pg.Pool;

  before(async () => {
    pool = createPool(databaseUrl!);
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await runMigrations(databaseUrl!);
  });
  after(() => pool?.end());

  it('el seed crea las tres placas ficticias con sus inspecciones', async () => {
    const vehicles = await new PgVehicleRepository(pool).findAll();
    assert.deepEqual(vehicles.map((vehicle) => vehicle.plate), ['ABC-1234', 'DEF-5678', 'GHI-9012']);
    assert.ok(vehicles.every((vehicle) => vehicle.inspections.length === 6));
    assert.equal(vehicles[0]!.soat.expirationDate, '2026-09-30');
    assert.equal(vehicles[0]!.inspections[0]!.code, 'body');
  });

  it('usuarios: correo único y en minúsculas', async () => {
    const users = new PgUserRepository(pool);
    const created = await users.create(newUser('integracion@example.com'));
    assert.ok(created);
    assert.equal(created.role, 'user');
    assert.equal(await users.create(newUser('integracion@example.com')), null);
    await assert.rejects(users.create(newUser('Mayus@Example.com')), /users_email_lowercase/);
  });

  it('actualiza inspecciones registrando el usuario', async () => {
    const user = (await new PgUserRepository(pool).create(newUser('tecnico-pg@example.com')))!;
    const service = new VehicleService(new PgVehicleRepository(pool));
    const vehicle = await service.updateInspection('ABC-1234', { inspectionId: 'steering', status: 'Aprobado', result: 'OK', notes: 'Validado' }, user.id);
    assert.equal(vehicle.inspections.find((item) => item.id === 'steering')!.updatedBy, 'tecnico-pg@example.com');
    await assert.rejects(service.updateInspection('ABC-1234', { inspectionId: 'radio', status: 'Aprobado', result: 'x', notes: 'y' }, user.id));
  });

  it('tokens de recuperación: un solo uso aun con solicitudes simultáneas, y se invalidan los demás', async () => {
    const user = (await new PgUserRepository(pool).create(newUser('reset-pg@example.com')))!;
    const tokens = new PgPasswordResetTokenRepository(pool);
    const now = new Date();
    const expires = new Date(now.getTime() + 30 * 60_000);
    await tokens.create(user.id, hashResetToken('token-a'), expires);
    await tokens.create(user.id, hashResetToken('token-b'), expires);
    await tokens.create(user.id, hashResetToken('token-expirado'), new Date(now.getTime() - 1000));

    assert.equal(await tokens.consume(hashResetToken('token-expirado'), now), null);
    const results = await Promise.all([tokens.consume(hashResetToken('token-a'), now), tokens.consume(hashResetToken('token-a'), now)]);
    assert.deepEqual(results.filter(Boolean), [user.id]);
    assert.equal(await tokens.consume(hashResetToken('token-b'), now), null);
  });

  it('refresh tokens: revocación única y por familia', async () => {
    const user = (await new PgUserRepository(pool).create(newUser('refresh-pg@example.com')))!;
    const repo = new PgRefreshTokenRepository(pool);
    const familyId = crypto.randomUUID();
    const first = { id: crypto.randomUUID(), userId: user.id, familyId };
    const second = { id: crypto.randomUUID(), userId: user.id, familyId };
    const expires = new Date(Date.now() + 60_000);
    await repo.create(first, expires);
    await repo.create(second, expires);

    const now = new Date();
    assert.deepEqual(await repo.revokeIfActive(first.id, now), first);
    assert.equal(await repo.revokeIfActive(first.id, now), null);
    await repo.revokeFamily(familyId, now);
    assert.equal(await repo.revokeIfActive(second.id, now), null);
  });
  it('verificación de correo: token de un solo uso y fecha que no se sobrescribe', async () => {
    const users = new PgUserRepository(pool);
    const user = (await users.create(newUser('verifica-pg@example.com')))!;
    assert.equal(user.emailVerifiedAt, null);

    const tokens = new PgEmailVerificationTokenRepository(pool);
    const now = new Date();
    await tokens.create(user.id, hashResetToken('verif-a'), new Date(now.getTime() + 60_000));
    assert.equal(await tokens.consume(hashResetToken('verif-a'), now), user.id);
    assert.equal(await tokens.consume(hashResetToken('verif-a'), now), null);

    const first = new Date('2026-11-01T10:00:00Z');
    await users.markEmailVerified(user.id, first);
    await users.markEmailVerified(user.id, new Date('2026-11-02T10:00:00Z'));
    assert.equal((await users.findById(user.id))!.emailVerifiedAt, first.toISOString());
  });
  it('borrar un usuario elimina en cascada sus sesiones y tokens', async () => {
    const users = new PgUserRepository(pool);
    const user = (await users.create(newUser('borrar-pg@example.com')))!;
    assert.ok(user.termsAcceptedAt);
    assert.equal(user.termsVersion, 'test');
    const expires = new Date(Date.now() + 60_000);
    await new PgRefreshTokenRepository(pool).create({ id: crypto.randomUUID(), userId: user.id, familyId: crypto.randomUUID() }, expires);
    await new PgPasswordResetTokenRepository(pool).create(user.id, hashResetToken('borrar-reset'), expires);
    await new PgEmailVerificationTokenRepository(pool).create(user.id, hashResetToken('borrar-verif'), expires);

    await users.delete(user.id);
    const { rows } = await pool.query(
      'SELECT (SELECT count(*) FROM refresh_tokens WHERE user_id = $1)::int AS refresh, (SELECT count(*) FROM password_reset_tokens WHERE user_id = $1)::int AS reset, (SELECT count(*) FROM email_verification_tokens WHERE user_id = $1)::int AS verif',
      [user.id]
    );
    assert.deepEqual(rows[0], { refresh: 0, reset: 0, verif: 0 });
    assert.equal(await users.findById(user.id), null);
  });
});
