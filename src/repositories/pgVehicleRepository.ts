import type pg from 'pg';
import type { InspectionChange, InspectionRecord, VehicleRecord, VehicleRepository } from './vehicleRepository.js';

const SELECT_VEHICLES = `
  SELECT v.*,
    COALESCE(
      json_agg(
        json_build_object(
          'code', i.code, 'category', i.category, 'name', i.name, 'status', i.status,
          'result', i.result, 'notes', i.notes, 'updatedByEmail', u.email, 'updatedAt', i.updated_at
        ) ORDER BY i.sort_order, i.code
      ) FILTER (WHERE i.id IS NOT NULL),
      '[]'
    ) AS inspections
  FROM vehicles v
  LEFT JOIN inspections i ON i.vehicle_id = v.id
  LEFT JOIN users u ON u.id = i.updated_by`;

interface VehicleRow {
  plate: string;
  brand: string;
  model: string;
  year: number;
  cylinder: string;
  chassis: string;
  owner_name: string;
  owner_document: string;
  color: string;
  fuel_type: string;
  transmission: string;
  mileage: number;
  registration_date: string;
  runt_number: string;
  runt_expires_on: string;
  soat_number: string;
  soat_expires_on: string;
  rtm_number: string;
  rtm_expires_on: string;
  updated_at: Date;
  inspections: Array<Omit<InspectionRecord, 'updatedAt'> & { updatedAt: string }>;
}

function toRecord(row: VehicleRow): VehicleRecord {
  return {
    plate: row.plate,
    brand: row.brand,
    model: row.model,
    year: row.year,
    cylinder: row.cylinder,
    chassis: row.chassis,
    ownerName: row.owner_name,
    ownerDocument: row.owner_document,
    color: row.color,
    fuelType: row.fuel_type,
    transmission: row.transmission,
    mileage: row.mileage,
    registrationDate: row.registration_date,
    runt: { number: row.runt_number, expirationDate: row.runt_expires_on },
    soat: { number: row.soat_number, expirationDate: row.soat_expires_on },
    rtm: { number: row.rtm_number, expirationDate: row.rtm_expires_on },
    inspections: row.inspections.map((item) => ({ ...item, updatedAt: new Date(item.updatedAt).toISOString() })),
    updatedAt: row.updated_at.toISOString()
  };
}

export class PgVehicleRepository implements VehicleRepository {
  constructor(private readonly pool: pg.Pool) {}

  async findAll(): Promise<VehicleRecord[]> {
    const { rows } = await this.pool.query<VehicleRow>(`${SELECT_VEHICLES} GROUP BY v.id ORDER BY v.plate`);
    return rows.map(toRecord);
  }

  async findByPlate(plate: string): Promise<VehicleRecord | null> {
    const { rows } = await this.pool.query<VehicleRow>(`${SELECT_VEHICLES} WHERE v.plate = $1 GROUP BY v.id`, [plate]);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async updateInspection(plate: string, code: string, change: InspectionChange, userId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `WITH updated AS (
         UPDATE inspections i
         SET status = $3, result = $4, notes = $5, updated_by = $6, updated_at = now()
         FROM vehicles v
         WHERE v.id = i.vehicle_id AND v.plate = $1 AND i.code = $2
         RETURNING i.vehicle_id
       )
       UPDATE vehicles SET updated_at = now() WHERE id IN (SELECT vehicle_id FROM updated)`,
      [plate, code, change.status, change.result, change.notes, userId]
    );
    return (rowCount ?? 0) > 0;
  }
}
