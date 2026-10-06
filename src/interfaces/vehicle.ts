export type VehicleStatus = 'Vigente' | 'Por Vencer' | 'Vencido';
export type AlertLevel = 'verde' | 'amarillo' | 'rojo';
export type InspectionStatus = 'Aprobado' | 'Atención' | 'No aprobado';

export interface InspectionItem {
  id: string;
  category: string;
  name: string;
  status: InspectionStatus;
  result: string;
  notes: string;
}

export interface DocumentStatus {
  number: string;
  status: VehicleStatus;
  expirationDate: string;
  alert: AlertLevel;
}

export interface VehicleData {
  plate: string;
  brand: string;
  model: string;
  year: number;
  cylinder: string;
  chassis: string;
  owner: string;
  ownerDocument: string;
  color: string;
  fuelType: string;
  transmission: string;
  mileage: number;
  registrationDate: string;
  runt: DocumentStatus;
  soat: DocumentStatus;
  rtm: DocumentStatus;
  inspections: InspectionItem[];
  overallStatus: VehicleStatus;
  lastUpdated: string;
}

export interface ScanResult {
  plate: string;
  source: 'image' | 'manual';
  confidence: number;
  detectedAt: string;
  vehicle: VehicleData;
}

export interface InspectionUpdate {
  inspectionId: string;
  status: InspectionStatus;
  result: string;
  notes: string;
  updatedBy: string;
}
