import type { AppConfig } from '../config/env.js';
import { NoVehicleLookupProvider, type VehicleLookupProvider } from './VehicleLookupProvider.js';
import { VerifikVehicleLookupProvider } from './verifikProvider.js';

export function createVehicleLookupProvider(config: AppConfig['runtProvider']): VehicleLookupProvider {
  return config.name === 'verifik' ? new VerifikVehicleLookupProvider(config.apiKey) : new NoVehicleLookupProvider();
}
