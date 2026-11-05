import { coloresDe, findTelltale, type Telltale, type TelltaleColor, type TelltalePowertrain, type TelltaleSeverity } from '../data/telltales.js';
import { detectImageType } from '../domain/imageSignature.js';
import { badRequest, HttpError, notFound, serviceUnavailable } from '../errors/httpError.js';
import type { DiagnosisRecord, DiagnosisRepository } from '../repositories/diagnosisRepository.js';
import type { FuelType, GarageRepository, GarageVehicleRecord } from '../repositories/garageRepository.js';
import {
  TelltaleIdentifierBusyError,
  TelltaleIdentifierUnavailableError,
  TelltaleIdentifierUnusableError,
  type TelltaleIdentification,
  type TelltaleIdentifier
} from './telltaleIdentifier.js';

export const MIN_CONFIDENCE = 0.6;
export const DIAGNOSIS_DISCLAIMER = 'Orientación general. Un mecánico debe confirmar el diagnóstico.';
export const NEVER_DRIVE_ACTION = 'Detente en un lugar seguro en cuanto puedas, apaga el motor y llama a un taller o a una grúa. No sigas manejando.';
export const SAFETY_SYSTEM_ACTION = 'El vehículo puede moverse, pero esta protección puede no funcionar en un choque. No dependas de ella y llévalo a revisión hoy.';
export const DIAGNOSIS_PROVIDER_BUSY_MESSAGE = 'El servicio gratuito de diagnóstico con IA está ocupado. Intenta en un minuto o elige el testigo de la lista.';
export const WHILE_UNIDENTIFIED_WARNING = 'Mientras lo identificas: si el testigo es rojo o notas algo raro al manejar, detente en un lugar seguro.';

const NEXT_STEP_WITH_IMAGE = 'Toma otra foto más cercana, sin reflejos y con el tablero encendido, o elígelo de la lista.';
const NEXT_STEP_WITH_TEXT = 'Cuéntanos su color y su forma, agrega una foto del tablero o elígelo de la lista.';
const REASON_UNIDENTIFIED = 'No pudimos identificar el testigo con seguridad.';
const REASON_COLOR_MISMATCH = 'El color que vimos no coincide con el testigo que parece ser.';
const REASON_COLOR_UNKNOWN = 'No pudimos confirmar el color del testigo, y de eso depende qué tan urgente es.';

// La nota es el único texto libre del modelo: no puede dar consejos de manejo ni de urgencia, ni incluir enlaces.
const UNSAFE_NOTE = /https?:|www\.|\b(manej|conduc|circul|rodar|rodando|segui|sigue|continu|ignor|grave|urgen|peligr|tranquil|sin problema|no pasa nada)/i;

const POWERTRAIN_BY_FUEL: Record<FuelType, TelltalePowertrain | null> = {
  Gasolina: 'gasolina',
  'Gasolina y gas': 'gasolina',
  'Gas natural': 'gasolina',
  Diésel: 'diesel',
  Híbrido: 'hibrido',
  Eléctrico: 'electrico',
  Otro: null
};

const POWERTRAIN_LABEL: Record<TelltalePowertrain, string> = { gasolina: 'gasolina', diesel: 'diésel', hibrido: 'híbridos', electrico: 'eléctricos' };

export interface Urgency {
  semaforo: TelltaleSeverity;
  titulo: string;
  accion: string;
  debeDetenerse: boolean;
  esFalla: boolean;
}

export interface DiagnosisContent {
  telltale: { id: string; nombre: string; descripcionSimbolo: string };
  severidad: TelltaleSeverity;
  urgencia: Urgency;
  significado: string;
  causasProbables: string[];
  puedesRevisar: string[];
  noHagas: string[];
  cuandoIrAlMecanico: string;
  notaEspecificaDelVehiculo: string | null;
  avisoCompatibilidad: string | null;
  aviso: string;
}

export type IdentificationVerdict =
  | { accepted: true; telltale: Telltale; parpadeando: boolean | null }
  | { accepted: false; reason: string };

/**
 * Decide si se puede creer lo que dijo el modelo. Ante la duda nunca elige: pide mejor entrada.
 * El servidor valida el color contra el catálogo para que un testigo rojo no pase por su pariente amarillo.
 */
export function evaluateIdentification(identification: TelltaleIdentification): IdentificationVerdict {
  const { telltaleId, telltaleAlternativo, colorObservado } = identification;
  const telltale = telltaleId ? findTelltale(telltaleId) : null;

  if (telltaleAlternativo && telltaleAlternativo !== telltaleId) {
    const alternative = findTelltale(telltaleAlternativo);
    if (telltale && alternative) return { accepted: false, reason: `Dudamos entre «${telltale.nombre}» y «${alternative.nombre}».` };
    return { accepted: false, reason: REASON_UNIDENTIFIED };
  }
  if (!telltale || identification.pideMejorEntrada || identification.confianza < MIN_CONFIDENCE) return { accepted: false, reason: REASON_UNIDENTIFIED };
  if (colorObservado === 'desconocido') {
    return telltale.exigeColor ? { accepted: false, reason: REASON_COLOR_UNKNOWN } : { accepted: true, telltale, parpadeando: identification.parpadeando };
  }
  if (!coloresDe(telltale).includes(colorObservado as TelltaleColor)) return { accepted: false, reason: REASON_COLOR_MISMATCH };
  return { accepted: true, telltale, parpadeando: identification.parpadeando };
}

export interface Diagnosed extends DiagnosisContent {
  status: 'diagnosed';
  id: string;
  origen: 'ia' | 'manual';
  confianza: number | null;
  createdAt: string;
}

export interface NeedsBetterInput {
  status: 'needs_better_input';
  pista: string;
  avisoSeguridad: string;
  puedeElegirDeLaLista: true;
}

export type DiagnosisResult = Diagnosed | NeedsBetterInput;

export interface DiagnosisInput {
  image?: Buffer;
  description?: string;
  telltaleId?: string;
}

export interface DiagnosisHistoryItem {
  id: string;
  telltaleId: string;
  nombre: string | null;
  severidad: TelltaleSeverity;
  origen: 'ia' | 'manual';
  confianza: number | null;
  descripcion: string | null;
  createdAt: string;
}

export interface DiagnosisHistory {
  items: DiagnosisHistoryItem[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

function urgencyFor(severity: TelltaleSeverity, stop: boolean): Urgency {
  if (stop) return { semaforo: 'rojo', titulo: 'Detente', accion: NEVER_DRIVE_ACTION, debeDetenerse: true, esFalla: true };
  if (severity === 'rojo') return { semaforo: 'rojo', titulo: 'Revísalo hoy', accion: SAFETY_SYSTEM_ACTION, debeDetenerse: false, esFalla: true };
  if (severity === 'amarillo') {
    return {
      semaforo: 'amarillo',
      titulo: 'Revísalo pronto',
      accion: 'Atiéndelo pronto. Si aparece un testigo rojo o notas algo raro al manejar, detente en un lugar seguro.',
      debeDetenerse: false,
      esFalla: true
    };
  }
  return {
    semaforo: 'informativo',
    titulo: 'Es un aviso, no una falla',
    accion: 'Este testigo informa un estado del vehículo y no indica una falla. Abajo te contamos en qué caso sí conviene revisarlo.',
    debeDetenerse: false,
    esFalla: false
  };
}

function compatibilityWarning(telltale: Telltale, fuelType: FuelType | null): string | null {
  const powertrain = fuelType ? POWERTRAIN_BY_FUEL[fuelType] : null;
  if (!powertrain || telltale.aplicaA.includes(powertrain)) return null;
  return `Este testigo normalmente no aparece en vehículos ${POWERTRAIN_LABEL[powertrain]}. Compara el símbolo con la descripción y revisa el combustible registrado en tu garaje.`;
}

/**
 * Compone la respuesta solo desde el catálogo. Las garantías de seguridad se aplican aquí, sin importar lo que diga el modelo:
 * neverDrive siempre es rojo con la orden de detenerse, y en un testigo rojo no se muestra la nota del modelo.
 * Un rojo sin neverDrive (airbag) sigue siendo rojo, pero no ordena detenerse. Un parpadeo confirmado de un testigo
 * con siParpadea (check engine) se trata como rojo, sin cambiar la severidad base del catálogo.
 */
export function composeDiagnosis(telltale: Telltale, options: { note?: string | null; fuelType?: FuelType | null; parpadeando?: boolean | null } = {}): DiagnosisContent {
  const blinking = options.parpadeando === true ? telltale.siParpadea : undefined;
  const stop = telltale.neverDrive || blinking !== undefined;
  const severidad: TelltaleSeverity = stop ? 'rojo' : telltale.severidad;
  const note = severidad !== 'rojo' && options.note && !UNSAFE_NOTE.test(options.note) ? options.note : null;
  return {
    telltale: { id: telltale.id, nombre: telltale.nombre, descripcionSimbolo: telltale.descripcionSimbolo },
    severidad,
    urgencia: urgencyFor(severidad, stop),
    significado: telltale.significado,
    causasProbables: telltale.causasProbables,
    puedesRevisar: telltale.puedesRevisar,
    noHagas: telltale.noHagas,
    cuandoIrAlMecanico: blinking?.cuandoIrAlMecanico ?? telltale.cuandoIrAlMecanico,
    notaEspecificaDelVehiculo: note,
    avisoCompatibilidad: compatibilityWarning(telltale, options.fuelType ?? null),
    aviso: DIAGNOSIS_DISCLAIMER
  };
}

const roundConfidence = (confidence: number) => Math.round(confidence * 100) / 100;

export class DiagnosisService {
  constructor(
    private readonly garage: GarageRepository,
    private readonly diagnoses: DiagnosisRepository,
    private readonly identifier: TelltaleIdentifier | null
  ) {}

  get enabled(): boolean {
    return this.identifier !== null;
  }

  get provider(): TelltaleIdentifier['provider'] | 'none' {
    return this.identifier?.provider ?? 'none';
  }

  /** La imagen se procesa en memoria y se descarta: no se escribe en disco, base de datos ni logs. */
  async diagnose(userId: string, plate: string, { image, description, telltaleId }: DiagnosisInput): Promise<DiagnosisResult> {
    if (!image && !description && !telltaleId) {
      throw badRequest('Adjunta una foto del testigo, descríbelo o elígelo de la lista.', { code: 'DIAGNOSIS_INPUT_REQUIRED' });
    }
    const mediaType = image ? detectImageType(image) : null;
    if (image && !mediaType) {
      throw new HttpError(415, 'El archivo no es una imagen JPEG, PNG o WEBP válida.', { code: 'UNSUPPORTED_IMAGE' });
    }
    const vehicle = await this.findVehicle(userId, plate);

    // Elección manual: es decisión del usuario y nunca pasa por la IA.
    if (telltaleId) {
      const telltale = findTelltale(telltaleId);
      if (!telltale) throw badRequest('Ese testigo no está en el catálogo. Elige uno de la lista.', { code: 'UNKNOWN_TELLTALE' });
      return this.save(userId, vehicle, telltale, { confianza: null, description, note: null });
    }

    if (!this.identifier) {
      throw serviceUnavailable('El diagnóstico con IA no está configurado en este servidor. Elige el testigo de la lista.', { code: 'AI_NOT_CONFIGURED' });
    }

    let identification: TelltaleIdentification;
    try {
      identification = await this.identifier.identify({
        ...(image && mediaType ? { image: { data: image, mediaType } } : {}),
        ...(description ? { description } : {}),
        vehicle: { brand: vehicle.brand, model: vehicle.model, year: vehicle.year, fuelType: vehicle.fuelType }
      });
    } catch (error) {
      if (error instanceof TelltaleIdentifierUnusableError) return this.needsBetterInput(Boolean(image), REASON_UNIDENTIFIED);
      if (error instanceof TelltaleIdentifierBusyError) {
        throw serviceUnavailable(DIAGNOSIS_PROVIDER_BUSY_MESSAGE, { code: 'DIAGNOSIS_PROVIDER_BUSY', retryAfterSeconds: 60 });
      }
      if (error instanceof TelltaleIdentifierUnavailableError) {
        throw serviceUnavailable('El diagnóstico con IA no está disponible en este momento. Intenta más tarde o elige el testigo de la lista.', {
          code: 'DIAGNOSIS_UNAVAILABLE'
        });
      }
      throw error;
    }

    const verdict = evaluateIdentification(identification);
    if (!verdict.accepted) return this.needsBetterInput(Boolean(image), verdict.reason);
    return this.save(userId, vehicle, verdict.telltale, {
      confianza: roundConfidence(identification.confianza),
      description,
      note: identification.notaEspecificaDelVehiculo ?? null,
      parpadeando: verdict.parpadeando
    });
  }

  async list(userId: string, plate: string, page: number, limit: number): Promise<DiagnosisHistory> {
    const vehicle = await this.findVehicle(userId, plate);
    const { items, total } = await this.diagnoses.list(userId, vehicle.id, { limit, offset: (page - 1) * limit });
    return { items: items.map(toHistoryItem), page, limit, total, totalPages: Math.ceil(total / limit) };
  }

  async remove(userId: string, plate: string, id: string): Promise<void> {
    const vehicle = await this.findVehicle(userId, plate);
    if (!(await this.diagnoses.delete(userId, vehicle.id, id))) throw notFound('No encontramos ese diagnóstico en el historial de este vehículo.');
  }

  private async save(
    userId: string,
    vehicle: GarageVehicleRecord,
    telltale: Telltale,
    { confianza, description, note, parpadeando = null }: { confianza: number | null; description: string | undefined; note: string | null; parpadeando?: boolean | null }
  ): Promise<Diagnosed> {
    const content = composeDiagnosis(telltale, { note, fuelType: vehicle.fuelType, parpadeando });
    const record = await this.diagnoses.create({
      userId,
      vehicleId: vehicle.id,
      telltaleId: telltale.id,
      severidad: content.severidad,
      confianza,
      descripcion: description ?? null
    });
    return { status: 'diagnosed', id: record.id, origen: confianza === null ? 'manual' : 'ia', confianza, createdAt: record.createdAt, ...content };
  }

  private needsBetterInput(hadImage: boolean, reason: string): NeedsBetterInput {
    return {
      status: 'needs_better_input',
      pista: `${reason} ${hadImage ? NEXT_STEP_WITH_IMAGE : NEXT_STEP_WITH_TEXT}`,
      avisoSeguridad: WHILE_UNIDENTIFIED_WARNING,
      puedeElegirDeLaLista: true
    };
  }

  // 404 también si la placa es de otro usuario: no se confirma su existencia.
  private async findVehicle(userId: string, plate: string): Promise<GarageVehicleRecord> {
    const vehicle = await this.garage.find(userId, plate);
    if (!vehicle) throw notFound('No tienes un vehículo con esta placa en tu garaje.', { plate });
    return vehicle;
  }
}

const toHistoryItem = (record: DiagnosisRecord): DiagnosisHistoryItem => ({
  id: record.id,
  telltaleId: record.telltaleId,
  nombre: findTelltale(record.telltaleId)?.nombre ?? null,
  severidad: record.severidad,
  origen: record.confianza === null ? 'manual' : 'ia',
  confianza: record.confianza,
  descripcion: record.descripcion,
  createdAt: record.createdAt
});
