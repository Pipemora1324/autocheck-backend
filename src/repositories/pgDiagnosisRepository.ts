import type pg from 'pg';
import type { TelltaleSeverity } from '../data/telltales.js';
import type { DiagnosisMessage, DiagnosisMessageRole, DiagnosisPage, DiagnosisRecord, DiagnosisRepository, NewDiagnosis, StoredDiagnosisResult } from './diagnosisRepository.js';

interface DiagnosisRow {
  id: string;
  user_id: string;
  vehicle_id: string;
  telltale_id: string | null;
  severidad: TelltaleSeverity;
  confianza: number | null;
  descripcion: string | null;
  resultado: StoredDiagnosisResult | null;
  created_at: Date;
}

interface MessageRow {
  id: string;
  role: DiagnosisMessageRole;
  content: string;
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
  resultado: row.resultado,
  createdAt: row.created_at.toISOString()
});

const toMessage = (row: MessageRow): DiagnosisMessage => ({ id: row.id, role: row.role, content: row.content, createdAt: row.created_at.toISOString() });

export class PgDiagnosisRepository implements DiagnosisRepository {
  constructor(private readonly pool: pg.Pool) {}

  async create(diagnosis: NewDiagnosis): Promise<DiagnosisRecord> {
    const { rows } = await this.pool.query<DiagnosisRow>(
      `INSERT INTO diagnoses (user_id, vehicle_id, telltale_id, severidad, confianza, descripcion, resultado)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [diagnosis.userId, diagnosis.vehicleId, diagnosis.telltaleId, diagnosis.severidad, diagnosis.confianza, diagnosis.descripcion, diagnosis.resultado === null ? null : JSON.stringify(diagnosis.resultado)]
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

  async find(userId: string, vehicleId: string, id: string): Promise<DiagnosisRecord | null> {
    const { rows } = await this.pool.query<DiagnosisRow>('SELECT * FROM diagnoses WHERE user_id = $1 AND vehicle_id = $2 AND id = $3', [userId, vehicleId, id]);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async delete(userId: string, vehicleId: string, id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query('DELETE FROM diagnoses WHERE user_id = $1 AND vehicle_id = $2 AND id = $3', [userId, vehicleId, id]);
    return (rowCount ?? 0) > 0;
  }

  async listMessages(diagnosisId: string): Promise<DiagnosisMessage[]> {
    const { rows } = await this.pool.query<MessageRow>('SELECT id, role, content, created_at FROM diagnosis_messages WHERE diagnosis_id = $1 ORDER BY created_at, id', [diagnosisId]);
    return rows.map(toMessage);
  }

  async countUserMessages(diagnosisId: string): Promise<number> {
    const { rows } = await this.pool.query<{ total: number }>("SELECT count(*)::int AS total FROM diagnosis_messages WHERE diagnosis_id = $1 AND role = 'user'", [diagnosisId]);
    return rows[0]?.total ?? 0;
  }

  async addExchange(diagnosisId: string, question: string, answer: string): Promise<{ question: DiagnosisMessage; answer: DiagnosisMessage }> {
    // Una sola sentencia: se guardan las dos filas o ninguna. La respuesta se fecha después para conservar el orden.
    const { rows } = await this.pool.query<MessageRow>(
      `INSERT INTO diagnosis_messages (diagnosis_id, role, content, created_at)
       VALUES ($1, 'user', $2, now()), ($1, 'assistant', $3, now() + interval '1 millisecond')
       RETURNING id, role, content, created_at`,
      [diagnosisId, question, answer]
    );
    const find = (role: DiagnosisMessageRole) => toMessage(rows.find((row) => row.role === role)!);
    return { question: find('user'), answer: find('assistant') };
  }
}
