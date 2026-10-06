import { getVehicleByPlate, vehicleData } from '../data/vehicleData.js';
import type { InspectionUpdate, ScanResult, VehicleData, VehicleStatus } from '../interfaces/vehicle.js';

const PLATE_PATTERN = /^[A-Z]{3}-\d{4}$/;
const INSPECTION_STATUSES = new Set(['Aprobado', 'Atención', 'No aprobado']);

export class VehicleService {
  getVehicle(plate: string): VehicleData | undefined {
    return getVehicleByPlate(plate);
  }

  getVehicles(): VehicleData[] {
    return vehicleData;
  }

  scanVehicle(plate: string, source: ScanResult['source']): ScanResult | null {
    const normalizedPlate = plate.trim().toUpperCase();
    if (!PLATE_PATTERN.test(normalizedPlate)) return null;

    const vehicle = getVehicleByPlate(normalizedPlate);
    if (!vehicle) return null;

    return {
      plate: normalizedPlate,
      source,
      confidence: source === 'image' ? 0.96 : 1,
      detectedAt: new Date().toISOString(),
      vehicle
    };
  }

  updateInspection(plate: string, update: InspectionUpdate): VehicleData | null {
    const normalizedPlate = plate.trim().toUpperCase();
    const vehicle = getVehicleByPlate(normalizedPlate);
    if (!PLATE_PATTERN.test(normalizedPlate) || !vehicle) return null;

    const inspection = vehicle.inspections.find((item) => item.id === update.inspectionId);
    if (!inspection) return null;
    if (!INSPECTION_STATUSES.has(update.status)) return null;
    if (typeof update.result !== 'string' || typeof update.notes !== 'string' || typeof update.updatedBy !== 'string') return null;
    if (!update.result.trim() || !update.notes.trim() || !update.updatedBy.trim()) return null;

    inspection.status = update.status;
    inspection.result = update.result.trim();
    inspection.notes = update.notes.trim();
    vehicle.lastUpdated = new Date().toISOString();
    vehicle.overallStatus = this.calculateOverallStatus(vehicle);
    return vehicle;
  }

  private calculateOverallStatus(vehicle: VehicleData): VehicleStatus {
    const failed = [vehicle.runt, vehicle.soat, vehicle.rtm].some((document) => document.status === 'Vencido');
    const attention = [vehicle.runt, vehicle.soat, vehicle.rtm].some((document) => document.status === 'Por Vencer')
      || vehicle.inspections.some((inspection) => inspection.status === 'Atención' || inspection.status === 'No aprobado');
    return failed ? 'Vencido' : attention ? 'Por Vencer' : 'Vigente';
  }
}
