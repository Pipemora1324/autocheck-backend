import type { InspectionStatus } from '../interfaces/vehicle.js';

export interface DocumentRecord {
  number: string;
  expirationDate: string;
}

export interface InspectionRecord {
  code: string;
  category: string;
  name: string;
  status: InspectionStatus;
  result: string;
  notes: string;
  updatedByEmail: string | null;
  updatedAt: string;
}

export interface VehicleRecord {
  plate: string;
  brand: string;
  model: string;
  year: number;
  cylinder: string;
  chassis: string;
  ownerName: string;
  ownerDocument: string;
  color: string;
  fuelType: string;
  transmission: string;
  mileage: number;
  registrationDate: string;
  runt: DocumentRecord;
  soat: DocumentRecord;
  rtm: DocumentRecord;
  inspections: InspectionRecord[];
  updatedAt: string;
}

export interface InspectionChange {
  status: InspectionStatus;
  result: string;
  notes: string;
}

export interface VehicleRepository {
  findAll(): Promise<VehicleRecord[]>;
  findByPlate(plate: string): Promise<VehicleRecord | null>;
  /** Devuelve false si la placa o la inspección no existen. */
  updateInspection(plate: string, code: string, change: InspectionChange, userId: string): Promise<boolean>;
}
