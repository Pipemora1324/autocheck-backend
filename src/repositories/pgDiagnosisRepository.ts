import type pg from 'pg';
import type { TelltaleSeverity } from '../data/telltales.js';
import type { DiagnosisPage, DiagnosisRecord, DiagnosisRepository, NewDiagnosis } from './diagnosisRepository.js';

interface DiagnosisRow {
  id: string;
  user_id: string;
  vehicle_id: string;
  telltale_id: string;
  severidad: TelltaleSeverity;
  confianza: number | null;
  descripcion: string | null;
  created_at: Date;
}

const toRecord = (row: DiagnosisRow): DiagnosisRecord => ({
  id: row.id,
  userId: row.user_id,
  vehicleId: row.vehicle_id,
  telltaleId: row.telltale_id,
  severidad: row.severidad,
  confianza: row.confianza,
  descripcion: row.descripcion,
  createdAt: row.created_at.toISOString()
});

export class PgDiagnosisRepository implements DiagnosisRepository {
  constructor(private readonly pool: pg.Pool) {}

  async create(diagnosis: NewDiagnosis): Promise<DiagnosisRecord> {
    const { rows } = await this.pool.query<DiagnosisRow>(
      `INSERT INTO diagnoses (user_id, vehicle_id, telltale_id, severidad, confianza, descripcion)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [diagnosis.userId, diagnosis.vehicleId, diagnosis.telltaleId, diagnosis.severidad, diagnosis.confianza, diagnosis.descripcion]
    );
    return toRecord(rows[0]!);
  }

  async list(userId: string, vehicleId: string, { limit, offset }: { limit: number; offset: number }): Promise<DiagnosisPage> {
    const [items, total] = await Promise.all([
      this.pool.query<DiagnosisRow>(
        `SELECT * FROM diagnoses WHERE user_id = $1 AND vehicle_id = $2
         ORDER BY created_at DESC, id DESC LIMIT $3 OFFSET $4`,
        [userId, vehicleId, limit, offset]
      ),
      this.pool.query<{ total: number }>('SELECT count(*)::int AS total FROM diagnoses WHERE user_id = $1 AND vehicle_id = $2', [userId, vehicleId])
    ]);
    return { items: items.rows.map(toRecord), total: total.rows[0]?.total ?? 0 };
  }

  async delete(userId: string, vehicleId: string, id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query('DELETE FROM diagnoses WHERE user_id = $1 AND vehicle_id = $2 AND id = $3', [userId, vehicleId, id]);
    return (rowCount ?? 0) > 0;
  }
}
