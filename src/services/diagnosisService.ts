import { findTelltale, type Telltale, type TelltalePowertrain, type TelltaleSeverity } from '../data/telltales.js';
import {
  applySafetyFloor,
  DIAGNOSIS_DISCLAIMER,
  INFO_ACTION,
  NEVER_DRIVE_ACTION,
  RED_ACTION,
  safeGeneralMessage,
  SAFETY_SYSTEM_ACTION,
  worstUrgency,
  YELLOW_ACTION,
  type FinalTelltale
} from '../domain/diagnosisSafety.js';
import { detectImageType, type SupportedImageType } from '../domain/imageSignature.js';
import { CACHE_TTL_SECONDS, cached, cacheKeys, noCache, type Cache } from './cache.js';
import { noRealtime, type DiagnosisStage, type RealtimeNotifier } from './realtime.js';
import { badRequest, HttpError, notFound, serviceUnavailable } from '../errors/httpError.js';
import type {
  DiagnosisRecord,
  DiagnosisRepository,
  StoredDiagnosisResult
} from '../repositories/diagnosisRepository.js';
import type { FuelType, GarageRepository, GarageVehicleRecord } from '../repositories/garageRepository.js';
import {
  TelltaleIdentifierBusyError,
  type DashboardReading,
  type TelltaleCategory,
  type TelltaleIdentifier
} from './telltaleIdentifier.js';

export { DIAGNOSIS_DISCLAIMER, NEVER_DRIVE_ACTION, SAFETY_SYSTEM_ACTION };

export const DIAGNOSIS_PROVIDER_BUSY_MESSAGE =
  'El servicio gratuito de diagnóstico con IA está ocupado. Intenta en un minuto o elige el testigo de la lista.';
export const DIAGNOSIS_PROVIDER_ERROR_MESSAGE =
  'El diagnóstico con IA falló por un problema del servicio, no por tu foto. Intenta más tarde o elige el testigo de la lista.';
const WHILE_UNIDENTIFIED_WARNING =
  'Mientras lo identificas: si el testigo es rojo o notas algo raro al manejar, detente en un lugar seguro.';

/** Por debajo de esto, y sin ningún testigo grave, se pide otra foto en lugar de mostrar una lectura poco fiable. */
const LOW_CONFIDENCE = 0.3;

const NEXT_STEP_WITH_IMAGE =
  'Toma otra foto más cercana, sin reflejos y con el tablero encendido, o elígelo de la lista.';
const NEXT_STEP_WITH_TEXT = 'Cuéntanos su color y su forma, agrega una foto del tablero o elígelo de la lista.';
const NOT_RECOGNIZED_MESSAGE = 'No vimos testigos encendidos en lo que nos enviaste.';

const POWERTRAIN_BY_FUEL: Record<FuelType, TelltalePowertrain | null> = {
  Gasolina: 'gasolina',
  'Gasolina y gas': 'gasolina',
  'Gas natural': 'gasolina',
  Diésel: 'diesel',
  Híbrido: 'hibrido',
  Eléctrico: 'electrico',
  Otro: null
};

const POWERTRAIN_LABEL: Record<TelltalePowertrain, string> = {
  gasolina: 'gasolina',
  diesel: 'diésel',
  hibrido: 'híbridos',
  electrico: 'eléctricos'
};

const CATALOG_CATEGORY: Record<string, TelltaleCategory> = {
  presion_aceite: 'aceite',
  nivel_aceite_bajo: 'aceite',
  temperatura_motor: 'temperatura',
  nivel_refrigerante: 'temperatura',
  sistema_frenos: 'frenos',
  pastillas_freno: 'frenos',
  freno_electrico_falla: 'frenos',
  freno_mano: 'freno_mano',
  direccion_asistida: 'direccion',
  airbag: 'airbag',
  bateria_alternador: 'bateria_carga',
  check_engine: 'motor_emisiones',
  epc: 'motor_emisiones',
  potencia_reducida: 'motor_emisiones',
  transmision: 'transmision',
  tpms: 'llantas',
  abs: 'estabilidad_abs',
  control_estabilidad: 'estabilidad_abs',
  estabilidad_apagado: 'estabilidad_abs',
  combustible_bajo: 'combustible',
  tapa_tanque: 'combustible',
  luces_altas: 'luces',
  antiniebla_delanteras: 'luces',
  antiniebla_traseras: 'luces',
  luz_exterior_fundida: 'luces',
  direccionales: 'luces'
};

type DiagnosisErrorKind = 'provider_error' | 'provider_busy';

export interface DiagnosedView extends StoredDiagnosisResult {
  status: 'diagnosed';
  id: string;
  origen: 'ia' | 'manual';
  confianza: number | null;
  descripcion: string | null;
  createdAt: string;
  aviso: string;
}

export type BetterInputReason = 'no_telltales_found' | 'low_confidence';

export interface NeedsBetterInput {
  status: 'needs_better_input';
  reason: BetterInputReason;
  pista: string;
  avisoSeguridad: string;
  puedeElegirDeLaLista: true;
}

interface NotRecognized {
  status: 'not_recognized';
  pista: string;
  avisoSeguridad: string;
  puedeElegirDeLaLista: true;
}

export type DiagnosisResult = DiagnosedView | NeedsBetterInput | NotRecognized;

export interface DiagnosisInput {
  image?: Buffer;
  description?: string;
  telltaleId?: string;
  blinking?: boolean;
  /** Generado por el cliente: identifica los eventos de progreso de esta solicitud. */
  requestId?: string;
}

interface DiagnosisHistoryItem {
  id: string;
  telltaleId: string | null;
  nombre: string | null;
  totalTestigos: number;
  severidad: TelltaleSeverity;
  debeDetenerse: boolean;
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

function compatibilityWarning(telltale: Telltale, fuelType: FuelType | null): string | null {
  const powertrain = fuelType ? POWERTRAIN_BY_FUEL[fuelType] : null;
  if (!powertrain || telltale.aplicaA.includes(powertrain)) return null;
  return `Este testigo normalmente no aparece en vehículos ${POWERTRAIN_LABEL[powertrain]}. Compara el símbolo con la descripción y revisa el combustible registrado en tu garaje.`;
}

const actionFor = (severity: TelltaleSeverity, stop: boolean, id: string): string => {
  if (stop) return NEVER_DRIVE_ACTION;
  if (id === 'airbag') return SAFETY_SYSTEM_ACTION;
  return severity === 'rojo' ? RED_ACTION : severity === 'amarillo' ? YELLOW_ACTION : INFO_ACTION;
};

/**
 * Elección manual: la explicación sale del catálogo y conserva sus garantías.
 * neverDrive siempre es rojo con la orden de detenerse. Un parpadeo confirmado de un testigo con siParpadea (check engine) se trata igual.
 */
export function composeFromCatalog(
  telltale: Telltale,
  options: { fuelType?: FuelType | null; blinking?: boolean } = {}
): FinalTelltale {
  const blinking = options.blinking === true ? telltale.siParpadea : undefined;
  const stop = telltale.neverDrive || blinking !== undefined;
  const urgencia: TelltaleSeverity = stop ? 'rojo' : telltale.severidad;
  return {
    nombre: telltale.nombre,
    descripcionSimbolo: telltale.descripcionSimbolo,
    color: 'desconocido',
    parpadeando: options.blinking ?? null,
    categoria: CATALOG_CATEGORY[telltale.id] ?? (telltale.severidad === 'informativo' ? 'informativo' : 'otro'),
    urgencia,
    significado: telltale.significado,
    porQuePasa: [...telltale.causasProbables],
    puedesRevisar: [...telltale.puedesRevisar],
    noHagas: [...telltale.noHagas],
    cuandoIrAlMecanico: blinking?.cuandoIrAlMecanico ?? telltale.cuandoIrAlMecanico,
    notaDelVehiculo: compatibilityWarning(telltale, options.fuelType ?? null),
    confianza: 1,
    debeDetenerse: stop,
    accion: actionFor(urgencia, stop, telltale.id)
  };
}

/** La urgencia general es la del testigo más grave, con la acción de ese testigo. */
function summarize(testigos: FinalTelltale[], mensajeGeneral: string, mejorFoto: string | null): StoredDiagnosisResult {
  const urgenciaGeneral = worstUrgency(testigos.map((item) => item.urgencia));
  const debeDetenerse = testigos.some((item) => item.debeDetenerse);
  const principal =
    testigos.find((item) => item.debeDetenerse) ?? testigos.find((item) => item.urgencia === urgenciaGeneral);
  // Los más graves primero, sin importar cómo los ordenó el modelo.
  const order: Record<TelltaleSeverity, number> = { rojo: 0, amarillo: 1, informativo: 2 };
  return {
    urgenciaGeneral,
    debeDetenerse,
    accionGeneral: principal?.accion ?? INFO_ACTION,
    mensajeGeneral: safeGeneralMessage(mensajeGeneral),
    mejorFoto,
    testigos: [...testigos].sort((a, b) => order[a.urgencia] - order[b.urgencia])
  };
}

/** Los diagnósticos guardados antes de esta versión solo tienen el id del catálogo: se recomponen desde ahí. */
export function resultOf(record: DiagnosisRecord, fuelType: FuelType | null = null): StoredDiagnosisResult | null {
  if (record.resultado) return record.resultado;
  const telltale = record.telltaleId ? findTelltale(record.telltaleId) : null;
  if (!telltale) return null;
  const blinking = record.severidad === 'rojo' && telltale.severidad !== 'rojo' && Boolean(telltale.siParpadea);
  return summarize([composeFromCatalog(telltale, { fuelType, blinking })], '', null);
}

const roundConfidence = (confidence: number) => Math.round(confidence * 100) / 100;

export interface DiagnosisServiceDeps {
  cache?: Cache;
  realtime?: RealtimeNotifier;
}

type ProgressReporter = (stage: DiagnosisStage, extra?: { result?: DiagnosisResult; status?: string }) => void;

interface AiDiagnosisInput {
  image: Buffer | undefined;
  mediaType: SupportedImageType | null;
  description: string | undefined;
  blinking: boolean | undefined;
}

export class DiagnosisService {
  private readonly cache: Cache;
  private readonly realtime: RealtimeNotifier;

  constructor(
    private readonly garage: GarageRepository,
    private readonly diagnoses: DiagnosisRepository,
    private readonly identifier: TelltaleIdentifier | null,
    { cache = noCache, realtime = noRealtime }: DiagnosisServiceDeps = {}
  ) {
    this.cache = cache;
    this.realtime = realtime;
  }

  get enabled(): boolean {
    return this.identifier !== null;
  }

  get provider(): TelltaleIdentifier['provider'] | 'none' {
    return this.identifier?.provider ?? 'none';
  }

  /** La imagen se procesa en memoria y se descarta: no se escribe en disco, base de datos ni logs. */
  async diagnose(
    userId: string,
    plate: string,
    { image, description, telltaleId, blinking, requestId }: DiagnosisInput
  ): Promise<DiagnosisResult> {
    if (!image && !description && !telltaleId) {
      throw badRequest('Adjunta una foto del testigo, descríbelo o elígelo de la lista.', {
        code: 'DIAGNOSIS_INPUT_REQUIRED'
      });
    }
    const mediaType = image ? detectImageType(image) : null;
    if (image && !mediaType) {
      throw new HttpError(415, 'El archivo no es una imagen JPEG, PNG o WEBP válida.', { code: 'UNSUPPORTED_IMAGE' });
    }
    const vehicle = await this.findVehicle(userId, plate);

    // Elección manual: es decisión del usuario y nunca pasa por la IA.
    if (telltaleId) {
      const telltale = findTelltale(telltaleId);
      if (!telltale)
        throw badRequest('Ese testigo no está en el catálogo. Elige uno de la lista.', { code: 'UNKNOWN_TELLTALE' });
      const content = composeFromCatalog(telltale, {
        fuelType: vehicle.fuelType,
        ...(blinking !== undefined ? { blinking } : {})
      });
      return this.save(userId, vehicle, summarize([content], '', null), { telltaleId, confianza: null, description });
    }

    if (!this.identifier) {
      throw serviceUnavailable(
        'El diagnóstico con IA no está configurado en este servidor. Elige el testigo de la lista.',
        { code: 'AI_NOT_CONFIGURED', status: 'provider_error' }
      );
    }

    const progress: ProgressReporter = (stage, extra = {}) => {
      if (requestId) this.realtime.emit(userId, 'diagnosis:progress', { requestId, stage, ...extra });
    };
    progress('queued');
    const result = await this.diagnoseWithAi(
      userId,
      vehicle,
      this.identifier,
      { image, mediaType, description, blinking },
      progress
    );
    progress('done', { result });
    return result;
  }

  private async diagnoseWithAi(
    userId: string,
    vehicle: GarageVehicleRecord,
    identifier: TelltaleIdentifier,
    { image, mediaType, description, blinking }: AiDiagnosisInput,
    progress: ProgressReporter
  ): Promise<DiagnosisResult> {
    progress('analyzing');
    let reading: DashboardReading;
    try {
      reading = await identifier.identify({
        ...(image && mediaType ? { image: { data: image, mediaType } } : {}),
        ...(description ? { description } : {}),
        ...(blinking !== undefined ? { blinking } : {}),
        vehicle: { brand: vehicle.brand, model: vehicle.model, year: vehicle.year, fuelType: vehicle.fuelType }
      });
    } catch (error) {
      // Una falla del proveedor nunca se disfraza de "toma otra foto". Solo se registra la clase de error.
      if (error instanceof TelltaleIdentifierBusyError) {
        progress('failed', { status: 'provider_busy' });
        console.warn('Diagnóstico con IA: provider_busy.');
        throw serviceUnavailable(DIAGNOSIS_PROVIDER_BUSY_MESSAGE, {
          code: 'DIAGNOSIS_PROVIDER_BUSY',
          status: 'provider_busy' satisfies DiagnosisErrorKind,
          retryAfterSeconds: 60
        });
      }
      progress('failed', { status: 'provider_error' });
      console.error(`Diagnóstico con IA: provider_error (${(error as Error).constructor.name}).`);
      throw serviceUnavailable(DIAGNOSIS_PROVIDER_ERROR_MESSAGE, {
        code: 'DIAGNOSIS_UNAVAILABLE',
        status: 'provider_error' satisfies DiagnosisErrorKind
      });
    }

    progress('drafting');
    const hadImage = Boolean(image);
    const safety = { ...(blinking !== undefined ? { blinking } : {}), ...(description ? { description } : {}) };
    const testigos = reading.testigos.map((item) => applySafetyFloor(item, safety));
    if (testigos.length === 0) {
      if (reading.necesitaMejorFoto)
        return this.needsBetterInput(hadImage, 'no_telltales_found', reading.motivoMejorFoto);
      return {
        status: 'not_recognized',
        pista: safeGeneralMessage(reading.mensajeGeneral) || NOT_RECOGNIZED_MESSAGE,
        avisoSeguridad: WHILE_UNIDENTIFIED_WARNING,
        puedeElegirDeLaLista: true
      };
    }
    // Un testigo grave nunca se descarta por baja confianza: mostrarlo de más es más seguro que ocultarlo.
    if (testigos.every((item) => item.confianza < LOW_CONFIDENCE && item.urgencia !== 'rojo')) {
      return this.needsBetterInput(hadImage, 'low_confidence', reading.motivoMejorFoto);
    }

    const mejorFoto = reading.necesitaMejorFoto ? (reading.motivoMejorFoto ?? NEXT_STEP_WITH_IMAGE) : null;
    return this.save(userId, vehicle, summarize(testigos, reading.mensajeGeneral, mejorFoto), {
      telltaleId: null,
      confianza: roundConfidence(Math.max(...testigos.map((item) => item.confianza))),
      description
    });
  }

  async list(userId: string, plate: string, page: number, limit: number): Promise<DiagnosisHistory> {
    const vehicle = await this.findVehicle(userId, plate);
    return cached(this.cache, cacheKeys.history(userId, vehicle.id, page, limit), CACHE_TTL_SECONDS.lists, async () => {
      const { items, total } = await this.diagnoses.list(userId, vehicle.id, { limit, offset: (page - 1) * limit });
      return { items: items.map(toHistoryItem), page, limit, total, totalPages: Math.ceil(total / limit) };
    });
  }

  /** Solo lee: no crea otra entrada ni llama a la IA. */
  async get(userId: string, plate: string, id: string): Promise<DiagnosedView> {
    const vehicle = await this.findVehicle(userId, plate);
    const record = await this.diagnoses.find(userId, vehicle.id, id);
    if (!record) throw notFound('No encontramos ese diagnóstico en el historial de este vehículo.');
    const result = resultOf(record, vehicle.fuelType);
    if (!result)
      throw notFound('Ese testigo ya no está en el catálogo, así que no podemos mostrar su explicación.', {
        code: 'TELLTALE_NOT_IN_CATALOG'
      });
    return toView(record, result);
  }

  async remove(userId: string, plate: string, id: string): Promise<void> {
    const vehicle = await this.findVehicle(userId, plate);
    if (!(await this.diagnoses.delete(userId, vehicle.id, id)))
      throw notFound('No encontramos ese diagnóstico en el historial de este vehículo.');
    await this.cache.deleteByPrefix(cacheKeys.userPrefix(userId));
    this.realtime.emit(userId, 'diagnosis:changed', { action: 'deleted', plate: vehicle.plate, id });
  }

  private async save(
    userId: string,
    vehicle: GarageVehicleRecord,
    result: StoredDiagnosisResult,
    {
      telltaleId,
      confianza,
      description
    }: { telltaleId: string | null; confianza: number | null; description: string | undefined }
  ): Promise<DiagnosedView> {
    const record = await this.diagnoses.create({
      userId,
      vehicleId: vehicle.id,
      telltaleId,
      severidad: result.urgenciaGeneral,
      confianza,
      descripcion: description ?? null,
      resultado: result
    });
    await this.cache.deleteByPrefix(cacheKeys.userPrefix(userId));
    this.realtime.emit(userId, 'diagnosis:changed', { action: 'created', plate: vehicle.plate, id: record.id });
    return toView(record, result);
  }

  private needsBetterInput(hadImage: boolean, reason: BetterInputReason, modelReason: string | null): NeedsBetterInput {
    return {
      status: 'needs_better_input',
      reason,
      pista: `${modelReason ?? 'No pudimos leer los testigos con seguridad.'} ${hadImage ? NEXT_STEP_WITH_IMAGE : NEXT_STEP_WITH_TEXT}`,
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

const toView = (record: DiagnosisRecord, result: StoredDiagnosisResult): DiagnosedView => ({
  status: 'diagnosed',
  id: record.id,
  origen: record.confianza === null ? 'manual' : 'ia',
  confianza: record.confianza,
  descripcion: record.descripcion,
  createdAt: record.createdAt,
  aviso: DIAGNOSIS_DISCLAIMER,
  ...result
});

const toHistoryItem = (record: DiagnosisRecord): DiagnosisHistoryItem => {
  const result = resultOf(record);
  return {
    id: record.id,
    telltaleId: record.telltaleId,
    nombre: result?.testigos[0]?.nombre ?? null,
    totalTestigos: result?.testigos.length ?? 0,
    severidad: record.severidad,
    // Si el testigo ya no está en el catálogo, se conserva lo más prudente según lo guardado.
    debeDetenerse: result?.debeDetenerse ?? record.severidad === 'rojo',
    origen: record.confianza === null ? 'manual' : 'ia',
    confianza: record.confianza,
    descripcion: record.descripcion,
    createdAt: record.createdAt
  };
};
