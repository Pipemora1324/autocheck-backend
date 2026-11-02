import { plateKind, type VehicleKind } from '../domain/colombianPlate.js';
import { conflict, notFound } from '../errors/httpError.js';
import type {
  GarageRepository,
  GarageVehicleData,
  GarageVehiclePatch,
  GarageVehicleRecord,
  VehicleSource
} from '../repositories/garageRepository.js';
import { expirationStatus, todayInColombia, type ExpirationStatus, type MissingExpiration } from './documentStatus.js';

export const MAX_VEHICLES_PER_USER = 50;
export const DUPLICATE_PLATE = 'DUPLICATE_PLATE';
export const GARAGE_LIMIT_REACHED = 'GARAGE_LIMIT_REACHED';

export type Verdict = 'Sin alertas' | 'Revisar' | 'No recomendado';
export type ReasonSeverity = 'alta' | 'media' | 'info';

export interface AssessmentReason {
  code: string;
  severity: ReasonSeverity;
  message: string;
}

export interface GarageVehicle extends GarageVehicleData {
  plate: string;
  kind: VehicleKind;
  source: VehicleSource;
  soat: ExpirationStatus | MissingExpiration;
  rtm: ExpirationStatus | MissingExpiration;
  createdAt: string;
  updatedAt: string;
}

export interface VehicleAssessment {
  plate: string;
  verdict: Verdict;
  reasons: AssessmentReason[];
  missingFields: string[];
  basedOn: {
    source: 'datos_registrados_por_el_usuario';
    dataOrigin: VehicleSource;
    official: false;
    evaluatedAt: string;
    evaluatedOn: string;
    timeZone: 'America/Bogota';
    disclaimer: string;
  };
}

const DISCLAIMER =
  'Concepto calculado únicamente con los datos registrados en tu garaje. No es una consulta oficial al RUNT, ' +
  'a la aseguradora del SOAT ni a un CDA, y no reemplaza un peritaje profesional. Verifica la información en las fuentes oficiales.';

// Primera revisión técnico-mecánica (art. 52 de la Ley 769 de 2002, modificado por el art. 201 del Decreto Ley 019 de 2012):
// particulares a los 5 años de la matrícula; motos y servicio público a los 2. Se aproxima con el año del modelo porque
// no se guarda la fecha de matrícula: por eso el mensaje dice "probablemente".
const firstRtmYears = (kind: VehicleKind, service: GarageVehicleData['serviceType']) =>
  kind === 'moto' || service === 'Público' ? 2 : 5;

const ACTIVE_RUNT_STATUSES = new Set(['ACTIVO', 'ACTIVA', 'VIGENTE']);

const formatDate = (date: string) => {
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
};

export class GarageService {
  constructor(
    private readonly garage: GarageRepository,
    private readonly now: () => Date = () => new Date()
  ) {}

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

  async assess(userId: string, plate: string): Promise<VehicleAssessment> {
    return this.assessVehicle(this.toVehicle(await this.findOrThrow(userId, plate)));
  }

  assessVehicle(vehicle: GarageVehicle): VehicleAssessment {
    const now = this.now();
    const today = todayInColombia(now);
    const reasons: AssessmentReason[] = [];
    const missingFields: string[] = [];

    const checkDocument = (name: 'SOAT' | 'RTM', status: GarageVehicle['soat']) => {
      if (status.status === 'Vencido') {
        reasons.push({
          code: `${name}_EXPIRED`,
          severity: 'alta',
          message: `${name === 'SOAT' ? 'El SOAT' : 'La revisión técnico-mecánica'} está vencid${name === 'SOAT' ? 'o' : 'a'} desde el ${formatDate(status.expirationDate!)}.`
        });
      } else if (status.status === 'Por Vencer') {
        reasons.push({
          code: `${name}_EXPIRING`,
          severity: 'media',
          message: `${name === 'SOAT' ? 'El SOAT' : 'La revisión técnico-mecánica'} vence en ${status.daysToExpire} día(s) (${formatDate(status.expirationDate!)}).`
        });
      }
    };

    checkDocument('SOAT', vehicle.soat);
    checkDocument('RTM', vehicle.rtm);

    if (!vehicle.soatExpiresOn) {
      missingFields.push('soatExpiresOn');
      reasons.push({ code: 'SOAT_MISSING', severity: 'media', message: 'Falta la fecha de vencimiento del SOAT.' });
    }

    if (!vehicle.rtmExpiresOn) {
      missingFields.push('rtmExpiresOn');
      const exemptYears = firstRtmYears(vehicle.kind, vehicle.serviceType);
      const age = vehicle.year === null ? null : Number(today.slice(0, 4)) - vehicle.year;
      if (age !== null && age < exemptYears) {
        reasons.push({
          code: 'RTM_PROBABLY_EXEMPT',
          severity: 'info',
          message: `Sin fecha de RTM: por el año del modelo, probablemente aún no requiere la primera revisión (se exige a los ${exemptYears} años de la matrícula).`
        });
      } else {
        reasons.push({ code: 'RTM_MISSING', severity: 'media', message: 'Falta la fecha de vencimiento de la revisión técnico-mecánica.' });
      }
    }

    if (vehicle.runtStatus && !ACTIVE_RUNT_STATUSES.has(vehicle.runtStatus.trim().toUpperCase())) {
      reasons.push({ code: 'RUNT_NOT_ACTIVE', severity: 'alta', message: `El estado registrado en el RUNT es "${vehicle.runtStatus}".` });
    }

    for (const [field, label] of [['year', 'año del modelo'], ['chassis', 'número de chasis']] as const) {
      if (vehicle[field] === null) {
        missingFields.push(field);
        reasons.push({ code: 'MISSING_DATA', severity: 'media', message: `Falta el ${label}: sin él no se puede contrastar el vehículo con sus documentos.` });
      }
    }
    for (const field of ['color', 'cylinderCc', 'fuelType', 'serviceType', 'runtStatus'] as const) {
      if (vehicle[field] === null) missingFields.push(field);
    }

    const verdict: Verdict = reasons.some((reason) => reason.severity === 'alta')
      ? 'No recomendado'
      : reasons.some((reason) => reason.severity === 'media')
        ? 'Revisar'
        : 'Sin alertas';

    return {
      plate: vehicle.plate,
      verdict,
      reasons,
      missingFields,
      basedOn: {
        source: 'datos_registrados_por_el_usuario',
        dataOrigin: vehicle.source,
        official: false,
        evaluatedAt: now.toISOString(),
        evaluatedOn: today,
        timeZone: 'America/Bogota',
        disclaimer: DISCLAIMER
      }
    };
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
    const now = this.now();
    const { id: _id, userId: _userId, ...data } = record;
    return {
      ...data,
      kind: plateKind(record.plate),
      soat: expirationStatus(record.soatExpiresOn, now),
      rtm: expirationStatus(record.rtmExpiresOn, now)
    };
  }
}
