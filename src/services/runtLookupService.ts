import { HttpError, notFound, serviceUnavailable } from '../errors/httpError.js';
import type { GarageRepository, GarageVehiclePatch } from '../repositories/garageRepository.js';
import type { OwnerDocument, VehicleLookupData, VehicleLookupProvider } from '../providers/VehicleLookupProvider.js';
import type { GarageService, GarageVehicle } from './garageService.js';

export interface RuntRefreshResult {
  vehicle: GarageVehicle;
  lookup: { provider: string; queriedAt: string; fieldsUpdated: Array<keyof VehicleLookupData> };
}

export class RuntLookupService {
  constructor(
    private readonly provider: VehicleLookupProvider,
    private readonly garage: GarageRepository,
    private readonly garageService: GarageService
  ) {}

  get status() {
    return { enabled: this.provider.enabled, provider: this.provider.name };
  }

  /**
   * Consulta el proveedor y actualiza el vehículo del garaje con los datos encontrados.
   * El documento del propietario solo viaja al proveedor: no se guarda ni se registra.
   */
  async refresh(userId: string, plate: string, ownerDocument: OwnerDocument): Promise<RuntRefreshResult> {
    if (!this.provider.enabled) {
      throw serviceUnavailable('La consulta al RUNT no está habilitada en este servidor. Usa los datos de tu garaje.', { code: 'RUNT_PROVIDER_DISABLED' });
    }
    if (!(await this.garage.find(userId, plate))) {
      throw notFound('No tienes un vehículo con esta placa en tu garaje.', { plate });
    }

    const result = await this.provider.lookupByPlate({ plate, ownerDocument });
    if (result.status === 'not_found') {
      throw notFound('El proveedor no encontró un vehículo con esa placa y ese documento del propietario.', { code: 'RUNT_NOT_FOUND', plate });
    }
    if (result.status === 'unavailable') {
      const notImplemented = result.reason === 'not_implemented';
      throw new HttpError(notImplemented ? 501 : 503, notImplemented
        ? 'El conector con el proveedor RUNT aún no está implementado. Usa los datos de tu garaje.'
        : 'El proveedor RUNT no está disponible en este momento. Intenta más tarde.', {
        code: notImplemented ? 'RUNT_PROVIDER_NOT_IMPLEMENTED' : 'RUNT_UNAVAILABLE'
      });
    }

    // Solo se sobrescriben los datos que el proveedor sí devolvió.
    const fieldsUpdated = (Object.keys(result.data) as Array<keyof VehicleLookupData>).filter((key) => result.data[key] !== null);
    const patch: GarageVehiclePatch = { source: 'runt' };
    for (const key of fieldsUpdated) Object.assign(patch, { [key]: result.data[key] });
    const vehicle = await this.garageService.update(userId, plate, patch);

    return { vehicle, lookup: { provider: result.provider, queriedAt: result.queriedAt, fieldsUpdated } };
  }
}
