import { z } from 'zod';
import { normalizePlate, PLATE_FORMAT_HINT } from '../domain/colombianPlate.js';
import { FUEL_TYPES, SERVICE_TYPES } from '../repositories/garageRepository.js';

/** Placa colombiana ABC-123 (carro) o ABC-12D (moto); acepta minúsculas, espacios y sin guion, y la normaliza. */
export const colombianPlateSchema = z.string({ error: 'La placa es obligatoria.' }).transform((value, context) => {
  const plate = normalizePlate(value);
  if (!plate) {
    context.addIssue({ code: 'custom', message: PLATE_FORMAT_HINT });
    return z.NEVER;
  }
  return plate;
});

export const garagePlateParamsSchema = z.object({ plate: colombianPlateSchema });

const currentYear = () => new Date().getFullYear();

const text = (label: string, max: number) =>
  z
    .string({ error: `${label} debe ser texto.` })
    .trim()
    .min(1, `${label} no puede estar vacío.`)
    .max(max, `${label} no puede superar ${max} caracteres.`);

// Campos opcionales: se aceptan null (o cadena vacía) para borrar el dato.
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? null : value), schema.nullable());

const vehicleFields = {
  brand: text('La marca', 60),
  model: text('El modelo o línea', 80),
  year: optional(
    z.coerce
      .number({ error: 'El año debe ser un número.' })
      .int('El año debe ser un número entero.')
      .min(1950, 'El año debe ser 1950 o posterior.')
      .refine((year) => year <= currentYear() + 1, 'El año no puede ser posterior al próximo año.')
  ),
  color: optional(text('El color', 40)),
  cylinderCc: optional(
    z.coerce
      .number({ error: 'El cilindraje debe ser un número en cc.' })
      .int('El cilindraje va en cc, sin decimales.')
      .min(1)
      .max(20000)
  ),
  chassis: optional(
    z
      .string()
      .trim()
      .toUpperCase()
      .pipe(
        z
          .string()
          .regex(/^[A-Z0-9-]{5,30}$/, 'El chasis solo puede tener letras, números y guiones (5 a 30 caracteres).')
      )
  ),
  fuelType: optional(z.enum(FUEL_TYPES, { error: `El combustible debe ser uno de: ${FUEL_TYPES.join(', ')}.` })),
  serviceType: optional(z.enum(SERVICE_TYPES, { error: `El servicio debe ser uno de: ${SERVICE_TYPES.join(', ')}.` })),
  mileageKm: optional(
    z.coerce
      .number({ error: 'El kilometraje debe ser un número.' })
      .int('El kilometraje va en km, sin decimales.')
      .min(0, 'El kilometraje no puede ser negativo.')
      .max(9_999_999, 'El kilometraje no puede superar 9.999.999 km.')
  )
};

/** POST /garage. source 'scan' indica que el usuario confirmó datos precargados desde la tarjeta. */
export const createGarageVehicleSchema = z
  .object({
    plate: colombianPlateSchema,
    ...vehicleFields,
    year: vehicleFields.year.default(null),
    color: vehicleFields.color.default(null),
    cylinderCc: vehicleFields.cylinderCc.default(null),
    chassis: vehicleFields.chassis.default(null),
    fuelType: vehicleFields.fuelType.default(null),
    serviceType: vehicleFields.serviceType.default(null),
    mileageKm: vehicleFields.mileageKm.default(null),
    source: z.enum(['manual', 'scan'], { error: 'source debe ser manual o scan.' }).default('manual')
  })
  .strict();

/** PATCH /garage/:plate: la placa no se edita (es la llave); se envían solo los campos a cambiar. */
export const updateGarageVehicleSchema = z
  .object(vehicleFields)
  .partial()
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, 'Envía al menos un campo para actualizar.');
