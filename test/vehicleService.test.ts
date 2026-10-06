import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { VehicleService } from '../src/services/vehicleService.js';

describe('VehicleService', () => {
  const service = new VehicleService();

  it('Consulta un vehículo por placa', () => {
    const vehicle = service.getVehicle('ABC-1234');
    assert.equal(vehicle?.brand, 'Toyota');
    assert.equal(vehicle?.runt.status, 'Vigente');
  });

  it('Escanea una placa válida', () => {
    const result = service.scanVehicle('DEF-5678', 'manual');
    assert.equal(result?.vehicle.plate, 'DEF-5678');
    assert.equal(result?.source, 'manual');
  });

  it('Rechaza una placa inválida', () => {
    assert.equal(service.scanVehicle('ABC1234', 'manual'), null);
  });

  it('Actualiza una inspección y recalcula el estado general', () => {
    const vehicle = service.updateInspection('ABC-1234', {
      inspectionId: 'steering',
      status: 'Aprobado',
      result: 'Revisión completada',
      notes: 'Suspensión validada por el técnico.',
      updatedBy: 'María López'
    });

    assert.equal(vehicle?.inspections.find((item) => item.id === 'steering')?.status, 'Aprobado');
    assert.equal(vehicle?.overallStatus, 'Por Vencer');
    assert.notEqual(vehicle?.lastUpdated, '2026-08-01T10:30:00.000Z');
  });
});
