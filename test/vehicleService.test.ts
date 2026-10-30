import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { HttpError } from '../src/errors/httpError.js';
import { VehicleService } from '../src/services/vehicleService.js';
import { demoVehicles } from './support/fixtures.js';
import { MemoryUserRepository, MemoryVehicleRepository } from './support/memoryRepositories.js';

const NOW = new Date('2026-09-15T15:00:00Z');

describe('VehicleService', () => {
  let users: MemoryUserRepository;
  let service: VehicleService;

  beforeEach(() => {
    users = new MemoryUserRepository();
    service = new VehicleService(new MemoryVehicleRepository(demoVehicles(), users), () => NOW);
  });

  it('consulta un vehículo por placa y calcula sus estados con la fecha actual', async () => {
    const vehicle = await service.getVehicle('ABC-1234');
    assert.equal(vehicle.brand, 'Toyota');
    assert.equal(vehicle.runt.status, 'Vigente');
    assert.equal(vehicle.soat.status, 'Por Vencer');
    assert.equal(vehicle.soat.daysToExpire, 15);
    assert.equal(vehicle.soat.alert, 'amarillo');
    assert.equal(vehicle.overallStatus, 'Por Vencer');
  });

  it('marca como vencido un vehículo con documentos vencidos', async () => {
    const vehicle = await service.getVehicle('DEF-5678');
    assert.equal(vehicle.runt.status, 'Vencido');
    assert.equal(vehicle.soat.alert, 'rojo');
    assert.equal(vehicle.rtm.status, 'Por Vencer');
    assert.equal(vehicle.overallStatus, 'Vencido');
  });

  it('el mismo vehículo cambia de estado al pasar el tiempo', async () => {
    const later = new VehicleService(new MemoryVehicleRepository(demoVehicles(), users), () => new Date('2027-03-05T15:00:00Z'));
    const vehicle = await later.getVehicle('GHI-9012');
    assert.equal(vehicle.soat.status, 'Vencido');
    assert.equal(vehicle.rtm.status, 'Por Vencer');
    assert.equal(vehicle.overallStatus, 'Vencido');
  });

  it('lanza 404 si la placa no existe', async () => {
    await assert.rejects(service.getVehicle('ZZZ-0000'), (error: HttpError) => error.status === 404);
  });

  it('escanea una placa registrada', async () => {
    const result = await service.scanVehicle('DEF-5678', 'manual');
    assert.equal(result.vehicle.plate, 'DEF-5678');
    assert.equal(result.confidence, 1);
  });

  it('actualiza una inspección, registra quién la hizo y recalcula el estado general', async () => {
    const admin = (await users.create('tecnico@example.com', 'hash'))!;
    const vehicle = await service.updateInspection(
      'ABC-1234',
      { inspectionId: 'steering', status: 'Aprobado', result: 'Revisión completada', notes: 'Suspensión validada.' },
      admin.id
    );
    const steering = vehicle.inspections.find((item) => item.id === 'steering')!;
    assert.equal(steering.status, 'Aprobado');
    assert.equal(steering.updatedBy, 'tecnico@example.com');
    assert.equal(vehicle.overallStatus, 'Por Vencer');
    assert.notEqual(vehicle.lastUpdated, '2026-08-01T10:30:00.000Z');
  });

  it('rechaza una inspección que no existe', async () => {
    await assert.rejects(
      service.updateInspection('ABC-1234', { inspectionId: 'radio', status: 'Aprobado', result: 'x', notes: 'y' }, 'user-id'),
      (error: HttpError) => error.status === 400
    );
  });
});
