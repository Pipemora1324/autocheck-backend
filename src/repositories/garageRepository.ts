export const FUEL_TYPES = [
  'Gasolina',
  'Diésel',
  'Eléctrico',
  'Híbrido',
  'Gas natural',
  'Gasolina y gas',
  'Otro'
] as const;
export const SERVICE_TYPES = ['Particular', 'Público', 'Oficial', 'Diplomático', 'Otro'] as const;

export type FuelType = (typeof FUEL_TYPES)[number];
export type ServiceType = (typeof SERVICE_TYPES)[number];
export type VehicleSource = 'manual' | 'scan';

/** Campos que el usuario puede registrar o editar. */
export interface GarageVehicleData {
  brand: string;
  model: string;
  year: number | null;
  color: string | null;
  cylinderCc: number | null;
  chassis: string | null;
  fuelType: FuelType | null;
  serviceType: ServiceType | null;
  mileageKm: number | null;
}

export interface GarageVehicleRecord extends GarageVehicleData {
  id: string;
  userId: string;
  plate: string;
  source: VehicleSource;
  createdAt: string;
  updatedAt: string;
}

export interface NewGarageVehicle extends GarageVehicleData {
  plate: string;
  source: VehicleSource;
}

export type GarageVehiclePatch = Partial<GarageVehicleData> & { source?: VehicleSource };

/** Todas las operaciones filtran por userId: un usuario nunca ve ni modifica vehículos de otro. */
export interface GarageRepository {
  list(userId: string): Promise<GarageVehicleRecord[]>;
  find(userId: string, plate: string): Promise<GarageVehicleRecord | null>;
  count(userId: string): Promise<number>;
  /** Devuelve null si el usuario ya tiene esa placa. */
  create(userId: string, vehicle: NewGarageVehicle): Promise<GarageVehicleRecord | null>;
  /** Devuelve null si la placa no existe en el garaje del usuario. */
  update(userId: string, plate: string, patch: GarageVehiclePatch): Promise<GarageVehicleRecord | null>;
  delete(userId: string, plate: string): Promise<boolean>;
}
