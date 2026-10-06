import type { VehicleData } from '../interfaces/vehicle.js';

export const vehicleData: VehicleData[] = [
  {
    plate: 'ABC-1234',
    brand: 'Toyota',
    model: 'Corolla',
    year: 2022,
    cylinder: '1.8L',
    chassis: 'TKY4U2E2NCV123456',
    owner: 'Ana María Pérez Rodríguez',
    ownerDocument: 'CC 12345678',
    color: 'Blanco',
    fuelType: 'Gasolina',
    transmission: 'Automática',
    mileage: 18420,
    registrationDate: '2022-05-14',
    runt: { number: 'RUNT-2022-001', status: 'Vigente', expirationDate: '2027-12-31', alert: 'verde' },
    soat: { number: 'SOAT-2026-001', status: 'Por Vencer', expirationDate: '2026-09-30', alert: 'amarillo' },
    rtm: { number: 'RTM-2026-001', status: 'Vigente', expirationDate: '2027-06-30', alert: 'verde' },
    inspections: [
      { id: 'body', category: 'Exterior', name: 'Carrocería y pintura', status: 'Aprobado', result: 'Sin daños visibles', notes: 'Revisión exterior correcta.' },
      { id: 'brakes', category: 'Frenos', name: 'Frenos y líquido', status: 'Aprobado', result: 'En buen estado', notes: 'Frenos delanteros y traseros aprobados.' },
      { id: 'steering', category: 'Dirección', name: 'Dirección y suspensión', status: 'Atención', result: 'Revisión pendiente', notes: 'Conjunto de suspensión requiere revisión.' },
      { id: 'lights', category: 'Iluminación', name: 'Luces y señales', status: 'Aprobado', result: 'Funciona correctamente', notes: 'Todas las luces están operativas.' },
      { id: 'tires', category: 'Neumáticos', name: 'Neumáticos y presión', status: 'Aprobado', result: 'Presión correcta', notes: 'Marcha estimada de 4.2 mm.' },
      { id: 'engine', category: 'Motor', name: 'Motor y escapes', status: 'Aprobado', result: 'Sin fallas detectadas', notes: 'Nivel de aceite dentro de parámetros.' }
    ],
    overallStatus: 'Por Vencer',
    lastUpdated: '2026-08-01T10:30:00.000Z'
  },
  {
    plate: 'DEF-5678',
    brand: 'Mazda',
    model: 'CX-5',
    year: 2021,
    cylinder: '2.0L',
    chassis: 'JM1V8W2F9MN123456',
    owner: 'Luis Alberto Vega Restrepo',
    ownerDocument: 'CC 87432190',
    color: 'Negro',
    fuelType: 'Diesel',
    transmission: 'Automática',
    mileage: 48200,
    registrationDate: '2021-09-22',
    runt: { number: 'RUNT-2021-002', status: 'Vencido', expirationDate: '2024-11-30', alert: 'rojo' },
    soat: { number: 'SOAT-2025-002', status: 'Vencido', expirationDate: '2025-08-31', alert: 'rojo' },
    rtm: { number: 'RTM-2025-002', status: 'Por Vencer', expirationDate: '2026-10-15', alert: 'amarillo' },
    inspections: [
      { id: 'body', category: 'Exterior', name: 'Carrocería y pintura', status: 'Atención', result: 'Daños menores', notes: 'Rayón en el lateral izquierdo.' },
      { id: 'brakes', category: 'Frenos', name: 'Frenos y líquido', status: 'No aprobado', result: 'Frenos desgastados', notes: 'Reemplazo recomendado.' },
      { id: 'steering', category: 'Dirección', name: 'Dirección y suspensión', status: 'Aprobado', result: 'Sin anomalías', notes: 'Sistema de suspensión correcto.' },
      { id: 'lights', category: 'Iluminación', name: 'Luces y señales', status: 'Aprobado', result: 'Funciona correctamente', notes: 'Todas las luces están operativas.' },
      { id: 'tires', category: 'Neumáticos', name: 'Neumáticos y presión', status: 'Atención', result: 'Neumático delantero roto', notes: 'Cambio recomendado antes de circular.' },
      { id: 'engine', category: 'Motor', name: 'Motor y escapes', status: 'Aprobado', result: 'Sin fallas detectadas', notes: 'Compra de aceite pendiente.' }
    ],
    overallStatus: 'Vencido',
    lastUpdated: '2026-07-28T09:15:00.000Z'
  },
  {
    plate: 'GHI-9012',
    brand: 'BMW',
    model: 'X3',
    year: 2023,
    cylinder: '2.0L',
    chassis: 'WBX5U5C52M4C12345',
    owner: 'Sofía Camila Torres Valencia',
    ownerDocument: 'CC 1010101010',
    color: 'Gris',
    fuelType: 'Híbrido',
    transmission: 'Automática',
    mileage: 12680,
    registrationDate: '2023-01-10',
    runt: { number: 'RUNT-2023-003', status: 'Vigente', expirationDate: '2028-01-31', alert: 'verde' },
    soat: { number: 'SOAT-2026-003', status: 'Vigente', expirationDate: '2027-01-31', alert: 'verde' },
    rtm: { number: 'RTM-2026-003', status: 'Vigente', expirationDate: '2027-03-31', alert: 'verde' },
    inspections: [
      { id: 'body', category: 'Exterior', name: 'Carrocería y pintura', status: 'Aprobado', result: 'Sin daños visibles', notes: 'Revisión exterior correcta.' },
      { id: 'brakes', category: 'Frenos', name: 'Frenos y líquido', status: 'Aprobado', result: 'En buen estado', notes: 'Frenos y líquido aprobados.' },
      { id: 'steering', category: 'Dirección', name: 'Dirección y suspensión', status: 'Aprobado', result: 'Sin anomalías', notes: 'Sistema correcto.' },
      { id: 'lights', category: 'Iluminación', name: 'Luces y señales', status: 'Aprobado', result: 'Funciona correctamente', notes: 'Todas las luces están operativas.' },
      { id: 'tires', category: 'Neumáticos', name: 'Neumáticos y presión', status: 'Aprobado', result: 'Presión correcta', notes: 'Marcha estimada de 5.1 mm.' },
      { id: 'engine', category: 'Motor', name: 'Motor y escapes', status: 'Aprobado', result: 'Sin fallas detectadas', notes: 'Sistema híbrido operativo.' }
    ],
    overallStatus: 'Vigente',
    lastUpdated: '2026-08-02T12:40:00.000Z'
  }
];

export function getVehicleByPlate(plate: string): VehicleData | undefined {
  const normalizedPlate = plate.trim().toUpperCase();
  return vehicleData.find((vehicle) => vehicle.plate === normalizedPlate);
}
