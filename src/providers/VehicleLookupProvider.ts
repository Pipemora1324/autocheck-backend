import type { FuelType, ServiceType } from '../repositories/garageRepository.js';

export const OWNER_DOCUMENT_TYPES = ['CC', 'CE', 'PA', 'NIT', 'RC'] as const;
export type OwnerDocumentType = (typeof OWNER_DOCUMENT_TYPES)[number];

export interface OwnerDocument {
  type: OwnerDocumentType;
  number: string;
}

export interface VehicleLookupInput {
  plate: string;
  /** Se envía al proveedor solo para esta consulta; nunca se guarda ni se registra en logs. */
  ownerDocument: OwnerDocument;
}

export interface VehicleLookupData {
  brand: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  cylinderCc: number | null;
  chassis: string | null;
  fuelType: FuelType | null;
  serviceType: ServiceType | null;
  /** Fechas 'YYYY-MM-DD'. */
  soatExpiresOn: string | null;
  rtmExpiresOn: string | null;
  runtStatus: string | null;
}

export type VehicleLookupResult =
  | { status: 'found'; provider: string; queriedAt: string; data: VehicleLookupData }
  | { status: 'not_found'; provider: string }
  | { status: 'unavailable'; provider: string; reason: 'disabled' | 'not_implemented' | 'error' };

/**
 * Proveedor de consulta de vehículos en el RUNT (por ejemplo, un agregador autorizado).
 * No se hace scraping de RUNT ni de ningún sitio oficial: solo APIs de proveedores con contrato.
 */
export interface VehicleLookupProvider {
  readonly name: string;
  readonly enabled: boolean;
  lookupByPlate(input: VehicleLookupInput): Promise<VehicleLookupResult>;
}

/** RUNT_PROVIDER=none (por defecto): no hay consulta externa; la app usa el garaje manual. */
export class NoVehicleLookupProvider implements VehicleLookupProvider {
  readonly name = 'none';
  readonly enabled = false;

  async lookupByPlate(): Promise<VehicleLookupResult> {
    return { status: 'unavailable', provider: this.name, reason: 'disabled' };
  }
}
