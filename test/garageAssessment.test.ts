import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type { GarageVehicleData } from '../src/repositories/garageRepository.js';
import { GarageService } from '../src/services/garageService.js';
import { MemoryGarageRepository } from './support/memoryRepositories.js';

// Mediodía en Bogotá del 2 de noviembre de 2026.
const NOW = new Date('2026-11-02T17:00:00Z');
const USER = 'f5c1a1c2-3b4d-4e5f-8a9b-0c1d2e3f4a5b';

const complete = (overrides: Partial<GarageVehicleData> = {}): GarageVehicleData => ({
  brand: 'Renault',
  model: 'Sandero',
  year: 2019,
  color: 'Gris',
  cylinderCc: 1598,
  chassis: '9FBBSRADDKM123456',
  fuelType: 'Gasolina',
  serviceType: 'Particular',
  soatExpiresOn: '2027-06-30',
  rtmExpiresOn: '2027-03-15',
  runtStatus: 'ACTIVO',
  ...overrides
});

describe('Garaje: estados y concepto', () => {
  let service: GarageService;
  beforeEach(() => {
    service = new GarageService(new MemoryGarageRepository(), () => NOW);
  });

  const assess = async (plate: string, data: GarageVehicleData) => {
    await service.create(USER, plate, data, 'manual');
    return service.assess(USER, plate);
  };

  it('calcula Vigente / Por Vencer / Vencido con la fecha de hoy en Colombia', async () => {
    const vehicle = await service.create(USER, 'ABC-123', complete({ soatExpiresOn: '2026-12-02', rtmExpiresOn: '2026-11-01' }), 'manual');
    assert.equal(vehicle.soat.status, 'Por Vencer');
    assert.equal(vehicle.soat.daysToExpire, 30);
    assert.equal(vehicle.rtm.status, 'Vencido');
    assert.equal(vehicle.rtm.daysToExpire, -1);
    assert.equal(vehicle.kind, 'carro');

    const later = await service.create(USER, 'ABC-124', complete({ soatExpiresOn: '2026-12-03' }), 'manual');
    assert.equal(later.soat.status, 'Vigente');
  });

  it('sin fecha, el estado es "Sin información"', async () => {
    const vehicle = await service.create(USER, 'ABC-125', complete({ soatExpiresOn: null }), 'manual');
    assert.deepEqual(vehicle.soat, { status: 'Sin información', expirationDate: null, daysToExpire: null, alert: 'gris' });
  });

  it('"Sin alertas" con todo vigente y completo', async () => {
    const result = await assess('ABC-126', complete());
    assert.equal(result.verdict, 'Sin alertas');
    assert.deepEqual(result.reasons, []);
    assert.deepEqual(result.missingFields, []);
  });

  it('"No recomendado" si el SOAT o la RTM están vencidos, con la razón y la fecha', async () => {
    const result = await assess('ABC-127', complete({ soatExpiresOn: '2026-10-15' }));
    assert.equal(result.verdict, 'No recomendado');
    const reason = result.reasons.find((item) => item.code === 'SOAT_EXPIRED')!;
    assert.equal(reason.severity, 'alta');
    assert.match(reason.message, /15\/10\/2026/);
  });

  it('"No recomendado" si el estado RUNT registrado no es activo', async () => {
    const result = await assess('ABC-128', complete({ runtStatus: 'CANCELADO' }));
    assert.equal(result.verdict, 'No recomendado');
    assert.ok(result.reasons.some((item) => item.code === 'RUNT_NOT_ACTIVE'));
  });

  it('"Revisar" si un documento está por vencer o faltan datos', async () => {
    const expiring = await assess('ABC-129', complete({ rtmExpiresOn: '2026-11-20' }));
    assert.equal(expiring.verdict, 'Revisar');
    assert.ok(expiring.reasons.some((item) => item.code === 'RTM_EXPIRING' && /18 día/.test(item.message)));

    const missing = await assess('ABC-130', complete({ soatExpiresOn: null, chassis: null, color: null }));
    assert.equal(missing.verdict, 'Revisar');
    assert.deepEqual(missing.missingFields.sort(), ['chassis', 'color', 'soatExpiresOn']);
    assert.ok(missing.reasons.some((item) => item.code === 'SOAT_MISSING'));
    assert.ok(missing.reasons.some((item) => item.code === 'MISSING_DATA'));
  });

  it('sin fecha de RTM: un carro particular reciente probablemente está exento; una moto de 3 años no', async () => {
    const newCar = await assess('ABC-131', complete({ year: 2024, rtmExpiresOn: null }));
    assert.equal(newCar.verdict, 'Sin alertas');
    assert.equal(newCar.reasons[0]!.code, 'RTM_PROBABLY_EXEMPT');
    assert.equal(newCar.reasons[0]!.severity, 'info');

    const moto = await assess('ABC-12D', complete({ year: 2023, rtmExpiresOn: null }));
    assert.equal(moto.verdict, 'Revisar');
    assert.ok(moto.reasons.some((item) => item.code === 'RTM_MISSING'));
  });

  it('basedOn deja claro que no es una consulta oficial', async () => {
    const result = await assess('ABC-132', complete());
    assert.equal(result.basedOn.official, false);
    assert.equal(result.basedOn.source, 'datos_registrados_por_el_usuario');
    assert.equal(result.basedOn.dataOrigin, 'manual');
    assert.equal(result.basedOn.timeZone, 'America/Bogota');
    assert.equal(result.basedOn.evaluatedOn, '2026-11-02');
    assert.match(result.basedOn.disclaimer, /No es una consulta oficial al RUNT/);
  });
});
