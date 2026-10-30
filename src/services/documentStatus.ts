import type { AlertLevel, DocumentStatus, VehicleStatus } from '../interfaces/vehicle.js';

export const EXPIRING_SOON_DAYS = 30;
const DAY_MS = 86_400_000;
const TIME_ZONE = 'America/Bogota';

// Fecha calendario (YYYY-MM-DD) en Colombia, para que el cambio de día no dependa de la zona del servidor.
export function todayInColombia(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function daysBetween(fromDate: string, toDate: string): number {
  return Math.round((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / DAY_MS);
}

const ALERTS: Record<VehicleStatus, AlertLevel> = { Vigente: 'verde', 'Por Vencer': 'amarillo', Vencido: 'rojo' };

export function documentStatus(number: string, expirationDate: string, now: Date): DocumentStatus {
  const daysToExpire = daysBetween(todayInColombia(now), expirationDate);
  const status: VehicleStatus = daysToExpire < 0 ? 'Vencido' : daysToExpire <= EXPIRING_SOON_DAYS ? 'Por Vencer' : 'Vigente';
  return { number, status, expirationDate, daysToExpire, alert: ALERTS[status] };
}
