import { plateKind, type VehicleKind } from '../domain/colombianPlate.js';
import { conflict, notFound } from '../errors/httpError.js';
import type {
  GarageRepository,
  GarageVehicleData,
  GarageVehiclePatch,
  GarageVehicleRecord,
  VehicleSource
} from '../repositories/garageRepository.js';

export const MAX_VEHICLES_PER_USER = 50;
export const DUPLICATE_PLATE = 'DUPLICATE_PLATE';
export const GARAGE_LIMIT_REACHED = 'GARAGE_LIMIT_REACHED';

export interface GarageVehicle extends GarageVehicleData {
  plate: string;
  kind: VehicleKind;
  source: VehicleSource;
  createdAt: string;
  updatedAt: string;
}

export class GarageService {
  constructor(private readonly garage: GarageRepository) {}

  async list(userId: string): Promise<GarageVehicle[]> {
    return (await this.garage.list(userId)).map((record) => this.toVehicle(record));
  }

  async get(userId: string, plate: string): Promise<GarageVehicle> {
    return this.toVehicle(await this.findOrThrow(userId, plate));
  }

  async create(userId: string, plate: string, data: GarageVehicleData, source: VehicleSource): Promise<GarageVehicle> {
    if ((await this.garage.count(userId)) >= MAX_VEHICLES_PER_USER) {
      throw conflict(`Alcanzaste el máximo de ${MAX_VEHICLES_PER_USER} vehículos en tu garaje.`, { code: GARAGE_LIMIT_REACHED });
    }
    const created = await this.garage.create(userId, { ...data, plate, source });
    if (!created) throw conflict('Ya tienes un vehículo con esta placa en tu garaje.', { code: DUPLICATE_PLATE, plate });
    return this.toVehicle(created);
  }

  async update(userId: string, plate: string, patch: GarageVehiclePatch): Promise<GarageVehicle> {
    const updated = await this.garage.update(userId, plate, patch);
    if (!updated) throw this.notInGarage(plate);
    return this.toVehicle(updated);
  }

  async remove(userId: string, plate: string): Promise<void> {
    if (!(await this.garage.delete(userId, plate))) throw this.notInGarage(plate);
  }

  private async findOrThrow(userId: string, plate: string): Promise<GarageVehicleRecord> {
    const record = await this.garage.find(userId, plate);
    if (!record) throw this.notInGarage(plate);
    return record;
  }

  // 404 también si la placa es de otro usuario: no se confirma su existencia.
  private notInGarage(plate: string) {
    return notFound('No tienes un vehículo con esta placa en tu garaje.', { plate });
  }

  private toVehicle(record: GarageVehicleRecord): GarageVehicle {
    const { id: _id, userId: _userId, ...data } = record;
    return { ...data, kind: plateKind(record.plate) };
  }
}
