import type { TelltaleSeverity } from '../data/telltales.js';

export interface NewDiagnosis {
  userId: string;
  vehicleId: string;
  telltaleId: string;
  severidad: TelltaleSeverity;
  /** null si el usuario eligió el testigo a mano. */
  confianza: number | null;
  descripcion: string | null;
}

export interface DiagnosisRecord extends NewDiagnosis {
  id: string;
  createdAt: string;
}

export interface DiagnosisPage {
  items: DiagnosisRecord[];
  total: number;
}

/** Todas las lecturas y borrados filtran por usuario y vehículo: nadie accede al historial de otro. */
export interface DiagnosisRepository {
  create(diagnosis: NewDiagnosis): Promise<DiagnosisRecord>;
  /** Del más reciente al más antiguo. */
  list(userId: string, vehicleId: string, page: { limit: number; offset: number }): Promise<DiagnosisPage>;
  delete(userId: string, vehicleId: string, id: string): Promise<boolean>;
}
