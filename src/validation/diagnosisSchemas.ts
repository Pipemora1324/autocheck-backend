import { z } from 'zod';
import { colombianPlateSchema } from './garageSchemas.js';

export const MAX_DESCRIPTION_LENGTH = 500;

const blankToUndefined = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? undefined : value);

/** Campos de texto de POST /garage/:plate/diagnoses. La imagen llega aparte, por multer. */
export const diagnosisInputSchema = z
  .object({
    description: z.preprocess(
      blankToUndefined,
      z
        .string({ error: 'La descripción debe ser texto.' })
        .trim()
        .max(MAX_DESCRIPTION_LENGTH, `La descripción no puede superar ${MAX_DESCRIPTION_LENGTH} caracteres.`)
        .optional()
    ),
    telltaleId: z.preprocess(blankToUndefined, z.string({ error: 'El testigo debe ser texto.' }).trim().max(60, 'Ese testigo no está en el catálogo.').optional())
  })
  .strict();

export const diagnosisIdParamsSchema = z.object({
  plate: colombianPlateSchema,
  id: z.uuid({ error: 'El identificador del diagnóstico no es válido.' })
});

export const diagnosisHistoryQuerySchema = z.object({
  page: z.coerce.number({ error: 'page debe ser un número.' }).int('page debe ser un entero.').min(1, 'page empieza en 1.').max(100_000).default(1),
  limit: z.coerce.number({ error: 'limit debe ser un número.' }).int('limit debe ser un entero.').min(1, 'limit mínimo es 1.').max(50, 'limit máximo es 50.').default(20)
});
