import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';
import { DEMO_DIAGNOSES, DEMO_VEHICLES } from '../scripts/demoData.js';
import {
  databaseHost,
  demoTimestamp,
  parseArgs,
  readCredentials,
  readingFor,
  repoMigrations,
  SeedError
} from '../scripts/seedDemo.js';
import { findTelltale } from '../src/data/telltales.js';
import { plateKind } from '../src/domain/colombianPlate.js';
import { suggestsDriving } from '../src/domain/diagnosisSafety.js';
import { composeFromCatalog } from '../src/services/diagnosisService.js';
import { createGarageVehicleSchema } from '../src/validation/garageSchemas.js';

// Valores obviamente falsos, generados en cada corrida: nunca son los de la cuenta real.
const FAKE_CLAVE = `falsa-${randomBytes(6).toString('hex')}`;
const FAKE_EMAIL = 'Demo.Falsa@Example.TEST';

describe('seed:demo - datos de demostración', () => {
  it('tiene entre 12 y 15 vehículos variados con placas DEM válidas y únicas', () => {
    assert.ok(DEMO_VEHICLES.length >= 12 && DEMO_VEHICLES.length <= 15);
    const plates = DEMO_VEHICLES.map((vehicle) => vehicle.plate);
    assert.equal(new Set(plates).size, plates.length);
    for (const vehicle of DEMO_VEHICLES) {
      assert.match(vehicle.plate, /^DEM-/);
      const { addedDaysAgo: _addedDaysAgo, ...fields } = vehicle;
      const parsed = createGarageVehicleSchema.parse({ ...fields, chassis: null });
      assert.equal(parsed.plate, vehicle.plate, 'la placa ya está normalizada');
      assert.ok(vehicle.year >= 2004 && vehicle.year <= 2024, vehicle.plate);
      assert.ok(vehicle.mileageKm > 0 && vehicle.mileageKm < 400_000, vehicle.plate);
    }
    const fuels = new Set(DEMO_VEHICLES.map((vehicle) => vehicle.fuelType));
    for (const fuel of ['Gasolina', 'Diésel', 'Híbrido', 'Eléctrico'] as const) assert.ok(fuels.has(fuel), fuel);
    assert.ok(DEMO_VEHICLES.some((vehicle) => plateKind(vehicle.plate) === 'moto'));
    assert.ok(
      DEMO_VEHICLES.some((vehicle) => /Hilux|D-Max|Frontier/.test(vehicle.model)),
      'incluye camionetas'
    );
  });

  it('tiene entre 25 y 35 diagnósticos de los últimos 90 días, posteriores al registro del vehículo', () => {
    assert.ok(DEMO_DIAGNOSES.length >= 25 && DEMO_DIAGNOSES.length <= 35);
    for (const diagnosis of DEMO_DIAGNOSES) {
      const vehicle = DEMO_VEHICLES.find((item) => item.plate === diagnosis.plate);
      assert.ok(vehicle, diagnosis.plate);
      assert.ok(diagnosis.daysAgo >= 1 && diagnosis.daysAgo < 90);
      assert.ok(vehicle.addedDaysAgo > diagnosis.daysAgo, `${diagnosis.plate} se registró antes de diagnosticarlo`);
      assert.ok(diagnosis.hour >= 0 && diagnosis.hour < 24 && diagnosis.minute >= 0 && diagnosis.minute < 60);
    }
    for (const vehicle of DEMO_VEHICLES)
      assert.ok(
        DEMO_DIAGNOSES.some((item) => item.plate === vehicle.plate),
        `${vehicle.plate} tiene al menos un diagnóstico`
      );
  });

  it('usa testigos del catálogo compatibles con el combustible, y varios diagnósticos tienen de 2 a 4', () => {
    for (const diagnosis of DEMO_DIAGNOSES) {
      const fuelType = DEMO_VEHICLES.find((item) => item.plate === diagnosis.plate)!.fuelType;
      const ids = diagnosis.kind === 'manual' ? [diagnosis.telltaleId] : diagnosis.testigos.map((t) => t.telltaleId);
      for (const id of ids) {
        const telltale = findTelltale(id);
        assert.ok(telltale, id);
        assert.equal(composeFromCatalog(telltale, { fuelType }).notaDelVehiculo, null, `${id} en ${diagnosis.plate}`);
      }
      if (diagnosis.kind === 'ia') {
        assert.ok(diagnosis.testigos.length <= 4);
        assert.equal(readingFor(diagnosis).testigos.length, diagnosis.testigos.length);
      }
    }
    const multi = DEMO_DIAGNOSES.filter((item) => item.kind === 'ia' && item.testigos.length >= 2);
    assert.ok(multi.length >= 4);
  });

  it('cubre rojos, amarillos e informativos de los testigos pedidos', () => {
    const ids = new Set(
      DEMO_DIAGNOSES.flatMap((item) =>
        item.kind === 'manual' ? [item.telltaleId] : item.testigos.map((t) => t.telltaleId)
      )
    );
    for (const id of [
      'presion_aceite',
      'temperatura_motor',
      'sistema_frenos',
      'direccion_asistida',
      'check_engine',
      'abs',
      'tpms',
      'control_estabilidad',
      'bateria_traccion_baja',
      'cinturon',
      'combustible_bajo',
      'mantenimiento'
    ])
      assert.ok(ids.has(id), id);
    assert.ok(
      DEMO_DIAGNOSES.some((item) => item.blinking === true),
      'hay un check engine parpadeando'
    );
    assert.ok(
      DEMO_DIAGNOSES.some((item) => item.kind === 'manual' && item.telltaleId === 'check_engine' && !item.blinking),
      'hay un check engine fijo'
    );
  });

  it('tiene de 6 a 8 conversaciones de 2 a 6 mensajes, y ninguna respuesta sugiere seguir manejando', () => {
    const chats = DEMO_DIAGNOSES.filter((item) => item.chat);
    assert.ok(chats.length >= 6 && chats.length <= 8);
    for (const item of chats) {
      const turns = item.chat ?? [];
      assert.ok(turns.length * 2 >= 2 && turns.length * 2 <= 6);
      for (const turn of turns) {
        assert.equal(suggestsDriving(turn.answer), false, turn.answer);
        assert.ok(turn.question.length > 0 && turn.answer.length <= 6000);
      }
    }
    const questions = chats.flatMap((item) => (item.chat ?? []).map((turn) => turn.question));
    assert.ok(questions.includes('¿Por qué está en rojo?'));
    assert.ok(questions.some((question) => /seguir manejando/.test(question)));
    assert.ok(questions.includes('¿Qué le digo al mecánico?'));
  });
});

describe('seed:demo - argumentos y entorno', () => {
  it('lee los modos y exige no combinar --reset con --remove', () => {
    assert.deepEqual(parseArgs([]), { mode: 'seed', yes: false });
    assert.deepEqual(parseArgs(['--yes']), { mode: 'seed', yes: true });
    assert.deepEqual(parseArgs(['--reset', '--yes']), { mode: 'reset', yes: true });
    assert.deepEqual(parseArgs(['--remove']), { mode: 'remove', yes: false });
    assert.throws(() => parseArgs(['--reset', '--remove']), SeedError);
  });

  it('una opción desconocida no repite su valor', () => {
    assert.throws(
      () => parseArgs([FAKE_CLAVE]),
      (error: Error) => error instanceof SeedError && !error.message.includes(FAKE_CLAVE)
    );
  });

  it('valida el correo y la contraseña con la política del registro, sin mostrar los valores', () => {
    const env = { DEMO_USER_EMAIL: FAKE_EMAIL, DEMO_USER_PASSWORD: FAKE_CLAVE };
    assert.deepEqual(readCredentials(env, 'seed'), { email: FAKE_EMAIL.toLowerCase(), password: FAKE_CLAVE });

    const short = 'corta1';
    assert.throws(
      () => readCredentials({ ...env, DEMO_USER_PASSWORD: short }, 'seed'),
      (error: Error) => /al menos 8 caracteres/.test(error.message) && !error.message.includes(short)
    );
    assert.throws(() => readCredentials({ ...env, DEMO_USER_PASSWORD: undefined }, 'seed'), /DEMO_USER_PASSWORD/);
    assert.throws(
      () => readCredentials({ ...env, DEMO_USER_EMAIL: 'no-es-correo' }, 'seed'),
      (error: Error) => /correo válido/.test(error.message) && !error.message.includes('no-es-correo')
    );
    assert.throws(
      () => readCredentials({ ...env, ADMIN_EMAILS: `otro@example.test, ${FAKE_EMAIL}` }, 'seed'),
      /ADMIN_EMAILS/
    );
    assert.deepEqual(readCredentials({ DEMO_USER_EMAIL: FAKE_EMAIL }, 'remove'), {
      email: FAKE_EMAIL.toLowerCase(),
      password: ''
    });
  });

  it('del DATABASE_URL solo muestra el host', () => {
    const url = new URL('postgresql://ep-falso-123.example.test:5432/autocheck?sslmode=require');
    url.username = 'usuario';
    url.password = randomBytes(6).toString('hex');
    assert.equal(databaseHost(url.toString()), 'ep-falso-123.example.test');
    assert.throws(() => databaseHost(undefined), SeedError);
    assert.throws(
      () => databaseHost('mysql://algo'),
      (error: Error) => !error.message.includes('mysql://algo')
    );
  });

  it('las fechas quedan en hora de Colombia y dentro de los últimos 90 días', () => {
    const now = new Date('2026-11-09T03:00:00Z'); // 8 de noviembre, 22:00 en Colombia
    const date = demoTimestamp(now, 1, 7, 42);
    assert.equal(date.toISOString(), '2026-11-07T12:42:00.000Z');
    for (const item of DEMO_DIAGNOSES) {
      const at = demoTimestamp(now, item.daysAgo, item.hour, item.minute).getTime();
      assert.ok(at < now.getTime() && now.getTime() - at < 90 * 86_400_000);
    }
  });

  it('conoce todas las migraciones del repositorio', () => {
    const names = repoMigrations();
    assert.ok(names.length > 0);
    assert.ok(names.includes('1762300100000_create-diagnosis-messages'));
    assert.deepEqual(names, [...names].sort());
  });
});
