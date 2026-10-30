import type { InspectionRecord, VehicleRecord } from '../../src/repositories/vehicleRepository.js';

const inspection = (code: string, status: InspectionRecord['status']): InspectionRecord => ({
  code,
  category: 'Categoría',
  name: `Inspección ${code}`,
  status,
  result: 'Resultado',
  notes: 'Notas',
  updatedByEmail: null,
  updatedAt: '2026-08-01T10:30:00.000Z'
});

const base = {
  cylinder: '2.0L',
  chassis: 'CHASIS-FICTICIO',
  ownerDocument: 'CC 0000000',
  color: 'Blanco',
  fuelType: 'Gasolina',
  transmission: 'Automática',
  mileage: 10_000,
  registrationDate: '2022-05-14'
};

/** Datos ficticios con las mismas placas y vencimientos del seed. */
export function demoVehicles(): VehicleRecord[] {
  return [
    {
      ...base,
      plate: 'ABC-1234',
      brand: 'Toyota',
      model: 'Corolla',
      year: 2022,
      ownerName: 'Ana María Pérez Rodríguez',
      runt: { number: 'RUNT-2022-001', expirationDate: '2027-12-31' },
      soat: { number: 'SOAT-2026-001', expirationDate: '2026-09-30' },
      rtm: { number: 'RTM-2026-001', expirationDate: '2027-06-30' },
      inspections: [inspection('body', 'Aprobado'), inspection('steering', 'Atención')],
      updatedAt: '2026-08-01T10:30:00.000Z'
    },
    {
      ...base,
      plate: 'DEF-5678',
      brand: 'Mazda',
      model: 'CX-5',
      year: 2021,
      ownerName: 'Luis Alberto Vega Restrepo',
      runt: { number: 'RUNT-2021-002', expirationDate: '2024-11-30' },
      soat: { number: 'SOAT-2025-002', expirationDate: '2025-08-31' },
      rtm: { number: 'RTM-2025-002', expirationDate: '2026-10-15' },
      inspections: [inspection('brakes', 'No aprobado')],
      updatedAt: '2026-07-28T09:15:00.000Z'
    },
    {
      ...base,
      plate: 'GHI-9012',
      brand: 'BMW',
      model: 'X3',
      year: 2023,
      ownerName: 'Sofía Camila Torres Valencia',
      runt: { number: 'RUNT-2023-003', expirationDate: '2028-01-31' },
      soat: { number: 'SOAT-2026-003', expirationDate: '2027-01-31' },
      rtm: { number: 'RTM-2026-003', expirationDate: '2027-03-31' },
      inspections: [inspection('body', 'Aprobado'), inspection('engine', 'Aprobado')],
      updatedAt: '2026-08-02T12:40:00.000Z'
    }
  ];
}
