export type VehicleKind = 'carro' | 'moto';

// Placas de servicio particular/público: carro ABC123, moto ABC12D. Se aceptan con o sin guion y espacios.
const CAR_PLATE = /^([A-Z]{3})[\s-]?(\d{3})$/;
const MOTORCYCLE_PLATE = /^([A-Z]{3})[\s-]?(\d{2}[A-Z])$/;

export const PLATE_FORMAT_HINT = 'Ingresa una placa colombiana válida: ABC-123 (carro) o ABC-12D (moto).';

/** Devuelve la placa normalizada (ABC-123 / ABC-12D) o null si no tiene un formato válido. */
export function normalizePlate(value: string): string | null {
  const upper = value.trim().toUpperCase();
  const match = CAR_PLATE.exec(upper) ?? MOTORCYCLE_PLATE.exec(upper);
  return match ? `${match[1]}-${match[2]}` : null;
}

export function plateKind(normalizedPlate: string): VehicleKind {
  return /\d$/.test(normalizedPlate) ? 'carro' : 'moto';
}
