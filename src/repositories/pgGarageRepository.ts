import type pg from 'pg';
import type {
  FuelType,
  GarageRepository,
  GarageVehiclePatch,
  GarageVehicleRecord,
  NewGarageVehicle,
  ServiceType,
  VehicleSource
} from './garageRepository.js';

const UNIQUE_VIOLATION = '23505';

interface UserVehicleRow {
  id: string;
  user_id: string;
  plate: string;
  brand: string;
  model: string;
  year: number | null;
  color: string | null;
  cylinder_cc: number | null;
  chassis: string | null;
  fuel_type: FuelType | null;
  service_type: ServiceType | null;
  soat_expires_on: string | null;
  rtm_expires_on: string | null;
  runt_status: string | null;
  source: VehicleSource;
  created_at: Date;
  updated_at: Date;
}

const toRecord = (row: UserVehicleRow): GarageVehicleRecord => ({
  id: row.id,
  userId: row.user_id,
  plate: row.plate,
  brand: row.brand,
  model: row.model,
  year: row.year,
  color: row.color,
  cylinderCc: row.cylinder_cc,
  chassis: row.chassis,
  fuelType: row.fuel_type,
  serviceType: row.service_type,
  soatExpiresOn: row.soat_expires_on,
  rtmExpiresOn: row.rtm_expires_on,
  runtStatus: row.runt_status,
  source: row.source,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString()
});

// Lista blanca campo → columna: el UPDATE dinámico nunca interpola nombres que vengan del cliente.
const COLUMNS: Record<keyof GarageVehiclePatch, string> = {
  brand: 'brand',
  model: 'model',
  year: 'year',
  color: 'color',
  cylinderCc: 'cylinder_cc',
  chassis: 'chassis',
  fuelType: 'fuel_type',
  serviceType: 'service_type',
  soatExpiresOn: 'soat_expires_on',
  rtmExpiresOn: 'rtm_expires_on',
  runtStatus: 'runt_status',
  source: 'source'
};

export class PgGarageRepository implements GarageRepository {
  constructor(private readonly pool: pg.Pool) {}

  async list(userId: string): Promise<GarageVehicleRecord[]> {
    const { rows } = await this.pool.query<UserVehicleRow>('SELECT * FROM user_vehicles WHERE user_id = $1 ORDER BY plate', [userId]);
    return rows.map(toRecord);
  }

  async find(userId: string, plate: string): Promise<GarageVehicleRecord | null> {
    const { rows } = await this.pool.query<UserVehicleRow>('SELECT * FROM user_vehicles WHERE user_id = $1 AND plate = $2', [userId, plate]);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async count(userId: string): Promise<number> {
    const { rows } = await this.pool.query<{ total: number }>('SELECT count(*)::int AS total FROM user_vehicles WHERE user_id = $1', [userId]);
    return rows[0]?.total ?? 0;
  }

  async create(userId: string, vehicle: NewGarageVehicle): Promise<GarageVehicleRecord | null> {
    try {
      const { rows } = await this.pool.query<UserVehicleRow>(
        `INSERT INTO user_vehicles (
           user_id, plate, brand, model, year, color, cylinder_cc, chassis, fuel_type, service_type,
           soat_expires_on, rtm_expires_on, runt_status, source
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING *`,
        [
          userId, vehicle.plate, vehicle.brand, vehicle.model, vehicle.year, vehicle.color, vehicle.cylinderCc, vehicle.chassis,
          vehicle.fuelType, vehicle.serviceType, vehicle.soatExpiresOn, vehicle.rtmExpiresOn, vehicle.runtStatus, vehicle.source
        ]
      );
      return toRecord(rows[0]!);
    } catch (error) {
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) return null;
      throw error;
    }
  }

  async update(userId: string, plate: string, patch: GarageVehiclePatch): Promise<GarageVehicleRecord | null> {
    const entries = (Object.keys(COLUMNS) as Array<keyof GarageVehiclePatch>).filter((key) => patch[key] !== undefined);
    if (entries.length === 0) return this.find(userId, plate);

    const assignments = entries.map((key, index) => `${COLUMNS[key]} = $${index + 3}`);
    const { rows } = await this.pool.query<UserVehicleRow>(
      `UPDATE user_vehicles SET ${assignments.join(', ')}, updated_at = now()
       WHERE user_id = $1 AND plate = $2
       RETURNING *`,
      [userId, plate, ...entries.map((key) => patch[key])]
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async delete(userId: string, plate: string): Promise<boolean> {
    const { rowCount } = await this.pool.query('DELETE FROM user_vehicles WHERE user_id = $1 AND plate = $2', [userId, plate]);
    return (rowCount ?? 0) > 0;
  }
}
