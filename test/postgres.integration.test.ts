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
import { PgDiagnosisRepository } from '../src/repositories/pgDiagnosisRepository.js';
import { PgGarageRepository } from '../src/repositories/pgGarageRepository.js';
import { hashResetToken } from '../src/services/authService.js';
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
  after(() => pool.end());

  it('usuarios: correo único y en minúsculas', async () => {
    const users = new PgUserRepository(pool);
    const created = await users.create(newUser('integracion@example.com'));
    assert.ok(created);
    assert.equal(created.role, 'user');
    assert.equal(await users.create(newUser('integracion@example.com')), null);
    await assert.rejects(users.create(newUser('Mayus@Example.com')), /users_email_lowercase/);
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
  it('garaje: placa única por usuario, edición parcial y borrado en cascada con el usuario', async () => {
    const users = new PgUserRepository(pool);
    const garage = new PgGarageRepository(pool);
    const owner = (await users.create(newUser('garaje-pg@example.com')))!;
    const other = (await users.create(newUser('garaje-otro-pg@example.com')))!;
    const base = {
      plate: 'ABC-123', brand: 'Renault', model: 'Sandero', year: 2019, color: null, cylinderCc: 1598, chassis: null,
      fuelType: 'Gasolina' as const, serviceType: 'Particular' as const, mileageKm: 85000, source: 'manual' as const
    };

    const created = (await garage.create(owner.id, base))!;
    assert.equal(created.fuelType, 'Gasolina');
    assert.equal(created.mileageKm, 85000);
    assert.equal(await garage.create(owner.id, base), null);
    assert.ok(await garage.create(other.id, base));
    await assert.rejects(garage.create(owner.id, { ...base, plate: 'ABC-1234' }), /user_vehicles_plate_format/);

    const updated = (await garage.update(owner.id, 'ABC-123', { color: 'Rojo', cylinderCc: null }))!;
    assert.equal(updated.color, 'Rojo');
    assert.equal(updated.cylinderCc, null);
    assert.equal(updated.model, 'Sandero');
    assert.ok(updated.updatedAt >= created.updatedAt);
    assert.equal(await garage.update(other.id, 'XYZ-999', { color: 'Azul' }), null);
    assert.equal((await garage.find(other.id, 'ABC-123'))!.color, null);

    assert.equal(await garage.count(owner.id), 1);
    await users.delete(owner.id);
    assert.equal(await garage.count(owner.id), 0);
    assert.equal(await garage.count(other.id), 1);
  });

  it('diagnósticos: historial paginado, aislado por usuario y borrado en cascada con el vehículo y con el usuario', async () => {
    const users = new PgUserRepository(pool);
    const garage = new PgGarageRepository(pool);
    const diagnoses = new PgDiagnosisRepository(pool);
    const owner = (await users.create(newUser('diagnostico-pg@example.com')))!;
    const other = (await users.create(newUser('diagnostico-otro-pg@example.com')))!;
    const vehicleData = { brand: 'Renault', model: 'Sandero', year: 2019, color: null, cylinderCc: null, chassis: null, fuelType: null, serviceType: null, mileageKm: null, source: 'manual' as const };
    const first = (await garage.create(owner.id, { ...vehicleData, plate: 'DGN-001' }))!;
    const second = (await garage.create(owner.id, { ...vehicleData, plate: 'DGN-002' }))!;

    const base = { userId: owner.id, vehicleId: first.id, telltaleId: 'check_engine', severidad: 'amarillo' as const, resultado: null };
    const older = await diagnoses.create({ ...base, confianza: 0.91, descripcion: 'luz naranja' });
    const newer = await diagnoses.create({ ...base, confianza: null, descripcion: null });
    await diagnoses.create({ ...base, vehicleId: second.id, confianza: 0.8, descripcion: null });
    assert.equal(older.confianza, 0.91);
    await assert.rejects(diagnoses.create({ ...base, severidad: 'verde' as never, confianza: null, descripcion: null }), /diagnoses_severidad_valid/);
    await assert.rejects(diagnoses.create({ ...base, confianza: 2, descripcion: null }), /diagnoses_confianza_valid/);
    await assert.rejects(diagnoses.create({ ...base, confianza: null, descripcion: 'x'.repeat(501) }), /diagnoses_descripcion_length/);

    const page = await diagnoses.list(owner.id, first.id, { limit: 1, offset: 0 });
    assert.equal(page.total, 2);
    assert.deepEqual(page.items.map((item) => item.id), [newer.id]);
    assert.deepEqual((await diagnoses.list(owner.id, first.id, { limit: 1, offset: 1 })).items.map((item) => item.id), [older.id]);

    assert.equal((await diagnoses.list(other.id, first.id, { limit: 10, offset: 0 })).total, 0);
    assert.equal((await diagnoses.find(owner.id, first.id, older.id))?.descripcion, 'luz naranja');
    assert.equal(await diagnoses.find(other.id, first.id, older.id), null);
    assert.equal(await diagnoses.find(owner.id, second.id, older.id), null);
    assert.equal(await diagnoses.delete(other.id, first.id, older.id), false);
    assert.equal(await diagnoses.delete(owner.id, first.id, older.id), true);
    assert.equal((await diagnoses.list(owner.id, first.id, { limit: 10, offset: 0 })).total, 1);

    await garage.delete(owner.id, 'DGN-001');
    assert.equal((await pool.query('SELECT count(*)::int AS total FROM diagnoses WHERE vehicle_id = $1', [first.id])).rows[0].total, 0);
    assert.equal((await pool.query('SELECT count(*)::int AS total FROM diagnoses WHERE user_id = $1', [owner.id])).rows[0].total, 1);

    await users.delete(owner.id);
    assert.equal((await pool.query('SELECT count(*)::int AS total FROM diagnoses WHERE user_id = $1', [owner.id])).rows[0].total, 0);
  });

  it('diagnóstico con IA: guarda los testigos en JSON sin telltale_id, y la conversación se borra en cascada', async () => {
    const users = new PgUserRepository(pool);
    const garage = new PgGarageRepository(pool);
    const diagnoses = new PgDiagnosisRepository(pool);
    const owner = (await users.create(newUser('chat-pg@example.com')))!;
    const vehicleData = { brand: 'Renault', model: 'Sandero', year: 2019, color: null, cylinderCc: null, chassis: null, fuelType: null, serviceType: null, mileageKm: null, source: 'manual' as const };
    const vehicle = (await garage.create(owner.id, { ...vehicleData, plate: 'CHT-001' }))!;
    const resultado = { urgenciaGeneral: 'rojo' as const, debeDetenerse: true, accionGeneral: 'Detente.', mensajeGeneral: 'Hola "ñ".', mejorFoto: null, testigos: [] };
    const base = { userId: owner.id, vehicleId: vehicle.id, telltaleId: null, severidad: 'rojo' as const, confianza: 0.9, descripcion: null, resultado };
    const countMessages = async (id: string) => (await pool.query('SELECT count(*)::int AS total FROM diagnosis_messages WHERE diagnosis_id = $1', [id])).rows[0].total;

    const first = await diagnoses.create(base);
    assert.equal(first.telltaleId, null);
    assert.deepEqual((await diagnoses.find(owner.id, vehicle.id, first.id))?.resultado, resultado);

    const saved = await diagnoses.addExchange(first.id, 'pregunta', 'respuesta');
    assert.equal(saved.question.role, 'user');
    assert.equal(saved.answer.role, 'assistant');
    await diagnoses.addExchange(first.id, 'otra', 'otra respuesta');
    assert.deepEqual((await diagnoses.listMessages(first.id)).map((item) => item.content), ['pregunta', 'respuesta', 'otra', 'otra respuesta']);
    assert.equal(await diagnoses.countUserMessages(first.id), 2);
    await assert.rejects(diagnoses.addExchange(first.id, 'x'.repeat(6001), 'r'), /diagnosis_messages_content_length/);
    assert.equal(await countMessages(first.id), 4, 'un intercambio inválido no deja la mitad guardada');

    await diagnoses.delete(owner.id, vehicle.id, first.id);
    assert.equal(await countMessages(first.id), 0);

    const second = await diagnoses.create(base);
    await diagnoses.addExchange(second.id, 'p', 'r');
    await garage.delete(owner.id, 'CHT-001');
    assert.equal(await countMessages(second.id), 0);

    const vehicleAgain = (await garage.create(owner.id, { ...vehicleData, plate: 'CHT-002' }))!;
    const third = await diagnoses.create({ ...base, vehicleId: vehicleAgain.id });
    await diagnoses.addExchange(third.id, 'p', 'r');
    await users.delete(owner.id);
    assert.equal(await countMessages(third.id), 0);
  });
});
