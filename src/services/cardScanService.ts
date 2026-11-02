import { normalizePlate, plateKind, type VehicleKind } from '../domain/colombianPlate.js';
import { detectImageType } from '../domain/imageSignature.js';
import { HttpError, serviceUnavailable } from '../errors/httpError.js';
import type { FuelType, ServiceType } from '../repositories/garageRepository.js';
import { CardReaderUnavailableError, CardUnreadableError, type CardReader, type RawCardExtraction } from './cardReader.js';

export interface Prefilled<T> {
  value: T | null;
  confidence: number;
}

export interface CardScanResult {
  vehicle: {
    plate: Prefilled<string>;
    brand: Prefilled<string>;
    model: Prefilled<string>;
    year: Prefilled<number>;
    color: Prefilled<string>;
    cylinderCc: Prefilled<number>;
    chassis: Prefilled<string>;
    fuelType: Prefilled<FuelType>;
    serviceType: Prefilled<ServiceType>;
  };
  kind: VehicleKind | null;
  /** Solo para la consulta opcional al proveedor RUNT. No se guarda en ningún lado. */
  ownerDocument: Prefilled<string>;
  warnings: string[];
  stored: false;
  next: { confirmWith: 'POST /garage'; source: 'scan' };
}

const fold = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

const FUEL_KEYWORDS: Array<[RegExp, FuelType]> = [
  [/(gasolina.*gas|gas.*gasolina)/, 'Gasolina y gas'],
  [/(gas natural|gnv|gnc)/, 'Gas natural'],
  [/(diesel|acpm)/, 'Diésel'],
  [/hibrid/, 'Híbrido'],
  [/electric/, 'Eléctrico'],
  [/gasolina/, 'Gasolina']
];

const SERVICE_KEYWORDS: Array<[RegExp, ServiceType]> = [
  [/particular/, 'Particular'],
  [/public/, 'Público'],
  [/oficial/, 'Oficial'],
  [/diplomat/, 'Diplomático']
];

const clamp = (confidence: number) => Math.round(Math.min(1, Math.max(0, Number.isFinite(confidence) ? confidence : 0)) * 100) / 100;

// Convierte el texto leído al tipo del garaje; si no se puede, el dato queda vacío con confianza 0.
const pick = <T>(raw: RawCardExtraction[keyof RawCardExtraction], parse: (text: string) => T | null): Prefilled<T> => {
  const item = raw as { value: string | null; confidence: number };
  const text = item.value?.trim();
  const value = text ? parse(text) : null;
  return value === null ? { value: null, confidence: 0 } : { value, confidence: clamp(item.confidence) };
};

const text = (max: number) => (value: string) => value.slice(0, max);

export class CardScanService {
  constructor(
    private readonly reader: CardReader | null,
    private readonly currentYear: () => number = () => new Date().getFullYear()
  ) {}

  get enabled(): boolean {
    return this.reader !== null;
  }

  /** Procesa la imagen en memoria y la descarta: no se escribe en disco, base de datos ni logs. */
  async scan(image: Buffer): Promise<CardScanResult> {
    if (!this.reader) {
      throw serviceUnavailable(
        'La lectura automática de la tarjeta no está configurada en este servidor. Registra el vehículo manualmente.',
        { code: 'VISION_NOT_CONFIGURED' }
      );
    }

    const mediaType = detectImageType(image);
    if (!mediaType) {
      throw new HttpError(415, 'El archivo no es una imagen JPEG, PNG o WEBP válida.', { code: 'UNSUPPORTED_IMAGE' });
    }

    let raw: RawCardExtraction;
    try {
      raw = await this.reader.read({ data: image, mediaType });
    } catch (error) {
      if (error instanceof CardUnreadableError) {
        throw new HttpError(422, 'No pudimos leer la tarjeta. Intenta con una foto más nítida, de frente y con buena luz.', { code: 'CARD_UNREADABLE' });
      }
      if (error instanceof CardReaderUnavailableError) {
        throw serviceUnavailable('La lectura automática no está disponible en este momento. Intenta más tarde o registra el vehículo manualmente.', {
          code: 'VISION_UNAVAILABLE'
        });
      }
      throw error;
    }

    if (!raw.isVehicleDocument) {
      throw new HttpError(422, 'La imagen no parece una licencia de tránsito (tarjeta de propiedad).', { code: 'NOT_A_VEHICLE_DOCUMENT' });
    }

    const maxYear = this.currentYear() + 1;
    const vehicle: CardScanResult['vehicle'] = {
      plate: pick(raw.plate, normalizePlate),
      brand: pick(raw.brand, text(60)),
      model: pick(raw.model, text(80)),
      year: pick(raw.year, (value) => {
        const year = Number(/\b(19|20)\d{2}\b/.exec(value)?.[0]);
        return year >= 1950 && year <= maxYear ? year : null;
      }),
      color: pick(raw.color, text(40)),
      cylinderCc: pick(raw.cylinderCc, (value) => {
        const cc = Number(value.replace(/[^\d]/g, ''));
        return cc >= 1 && cc <= 20000 ? cc : null;
      }),
      chassis: pick(raw.chassis, (value) => {
        const chassis = value.toUpperCase().replace(/\s+/g, '');
        return /^[A-Z0-9-]{5,30}$/.test(chassis) ? chassis : null;
      }),
      fuelType: pick(raw.fuelType, (value) => FUEL_KEYWORDS.find(([pattern]) => pattern.test(fold(value)))?.[1] ?? null),
      serviceType: pick(raw.serviceType, (value) => SERVICE_KEYWORDS.find(([pattern]) => pattern.test(fold(value)))?.[1] ?? null)
    };

    const warnings = raw.warnings.map((warning) => warning.slice(0, 200)).slice(0, 5);
    if (raw.plate.value && !vehicle.plate.value) warnings.push('La placa leída no tiene un formato colombiano válido: escríbela manualmente.');

    return {
      vehicle,
      kind: vehicle.plate.value ? plateKind(vehicle.plate.value) : null,
      ownerDocument: pick(raw.ownerDocument, text(30)),
      warnings,
      stored: false,
      next: { confirmWith: 'POST /garage', source: 'scan' }
    };
  }
}
