import type { TelltaleSeverity } from '../data/telltales.js';
import type { FinalTelltale } from '../domain/diagnosisSafety.js';

/** Lo que se guarda para releer un diagnóstico sin llamar a la IA. Nunca incluye la imagen. */
export interface StoredDiagnosisResult {
  urgenciaGeneral: TelltaleSeverity;
  debeDetenerse: boolean;
  accionGeneral: string;
  mensajeGeneral: string;
  mejorFoto: string | null;
  testigos: FinalTelltale[];
}

export interface NewDiagnosis {
  userId: string;
  vehicleId: string;
  /** Solo en la elección manual: un diagnóstico con IA no sale del catálogo. */
  telltaleId: string | null;
  severidad: TelltaleSeverity;
  /** null si el usuario eligió el testigo a mano. */
  confianza: number | null;
  descripcion: string | null;
  /** null solo en filas anteriores a esta columna. */
  resultado: StoredDiagnosisResult | null;
}

export interface DiagnosisRecord extends NewDiagnosis {
  id: string;
  createdAt: string;
}

export interface DiagnosisPage {
  items: DiagnosisRecord[];
  total: number;
}

export type DiagnosisMessageRole = 'user' | 'assistant';

export interface DiagnosisMessage {
  id: string;
  role: DiagnosisMessageRole;
  content: string;
  createdAt: string;
}

/** Todas las lecturas y borrados filtran por usuario y vehículo: nadie accede al historial de otro. */
export interface DiagnosisRepository {
  create(diagnosis: NewDiagnosis): Promise<DiagnosisRecord>;
  /** Del más reciente al más antiguo. */
  list(userId: string, vehicleId: string, page: { limit: number; offset: number }): Promise<DiagnosisPage>;
  find(userId: string, vehicleId: string, id: string): Promise<DiagnosisRecord | null>;
  delete(userId: string, vehicleId: string, id: string): Promise<boolean>;
  /** Del más antiguo al más reciente. El llamador ya comprobó que el diagnóstico es del usuario. */
  listMessages(diagnosisId: string): Promise<DiagnosisMessage[]>;
  countUserMessages(diagnosisId: string): Promise<number>;
  /** Guarda la pregunta y la respuesta juntas, o ninguna. */
  addExchange(
    diagnosisId: string,
    question: string,
    answer: string
  ): Promise<{ question: DiagnosisMessage; answer: DiagnosisMessage }>;
}
