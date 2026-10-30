import { badRequest, notFound } from '../errors/httpError.js';
import type { InspectionUpdate, ScanResult, VehicleData, VehicleStatus } from '../interfaces/vehicle.js';
import type { VehicleRecord, VehicleRepository } from '../repositories/vehicleRepository.js';
import { documentStatus } from './documentStatus.js';

export class VehicleService {
  constructor(
    private readonly vehicles: VehicleRepository,
    private readonly now: () => Date = () => new Date()
  ) {}

  async getVehicle(plate: string): Promise<VehicleData> {
    const record = await this.vehicles.findByPlate(plate);
    if (!record) throw notFound('No se encontró un vehículo con esta placa.', { plate });
    return this.toVehicleData(record);
  }

  async getVehicles(): Promise<VehicleData[]> {
    const records = await this.vehicles.findAll();
    return records.map((record) => this.toVehicleData(record));
  }

  async scanVehicle(plate: string, source: ScanResult['source']): Promise<ScanResult> {
    const vehicle = await this.getVehicle(plate);
    return {
      plate,
      source,
      confidence: source === 'image' ? 0.96 : 1,
      detectedAt: this.now().toISOString(),
      vehicle
    };
  }

  async updateInspection(plate: string, update: InspectionUpdate, userId: string): Promise<VehicleData> {
    const updated = await this.vehicles.updateInspection(
      plate,
      update.inspectionId,
      { status: update.status, result: update.result, notes: update.notes },
      userId
    );
    if (!updated) {
      const exists = await this.vehicles.findByPlate(plate);
      if (!exists) throw notFound('No se encontró un vehículo con esta placa.', { plate });
      throw badRequest('La inspección indicada no existe para este vehículo.', { inspectionId: update.inspectionId });
    }
    return this.getVehicle(plate);
  }

  private toVehicleData(record: VehicleRecord): VehicleData {
    const now = this.now();
    const runt = documentStatus(record.runt.number, record.runt.expirationDate, now);
    const soat = documentStatus(record.soat.number, record.soat.expirationDate, now);
    const rtm = documentStatus(record.rtm.number, record.rtm.expirationDate, now);
    const inspections = record.inspections.map((item) => ({
      id: item.code,
      category: item.category,
      name: item.name,
      status: item.status,
      result: item.result,
      notes: item.notes,
      updatedBy: item.updatedByEmail,
      updatedAt: item.updatedAt
    }));

    const documents = [runt, soat, rtm];
    const failed = documents.some((document) => document.status === 'Vencido');
    const attention = documents.some((document) => document.status === 'Por Vencer')
      || inspections.some((inspection) => inspection.status === 'Atención' || inspection.status === 'No aprobado');
    const overallStatus: VehicleStatus = failed ? 'Vencido' : attention ? 'Por Vencer' : 'Vigente';

    return {
      plate: record.plate,
      brand: record.brand,
      model: record.model,
      year: record.year,
      cylinder: record.cylinder,
      chassis: record.chassis,
      owner: record.ownerName,
      ownerDocument: record.ownerDocument,
      color: record.color,
      fuelType: record.fuelType,
      transmission: record.transmission,
      mileage: record.mileage,
      registrationDate: record.registrationDate,
      runt,
      soat,
      rtm,
      inspections,
      overallStatus,
      lastUpdated: record.updatedAt
    };
  }
}
