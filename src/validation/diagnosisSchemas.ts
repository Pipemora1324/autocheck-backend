import { z } from 'zod';
import { colombianPlateSchema } from './garageSchemas.js';

const MAX_DESCRIPTION_LENGTH = 500;
const MAX_CHAT_MESSAGE_LENGTH = 500;

const blankToUndefined = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? undefined : value);
/** Un formulario multipart solo envía texto. */
const textToBoolean = (value: unknown) => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return blankToUndefined(value);
};

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
    telltaleId: z.preprocess(
      blankToUndefined,
      z.string({ error: 'El testigo debe ser texto.' }).trim().max(60, 'Ese testigo no está en el catálogo.').optional()
    ),
    parpadea: z.preprocess(textToBoolean, z.boolean({ error: 'parpadea debe ser true o false.' }).optional())
  })
  .strict();

export const diagnosisIdParamsSchema = z.object({
  plate: colombianPlateSchema,
  id: z.uuid({ error: 'El identificador del diagnóstico no es válido.' })
});

export const diagnosisHistoryQuerySchema = z.object({
  page: z.coerce
    .number({ error: 'page debe ser un número.' })
    .int('page debe ser un entero.')
    .min(1, 'page empieza en 1.')
    .max(100_000)
    .default(1),
  limit: z.coerce
    .number({ error: 'limit debe ser un número.' })
    .int('limit debe ser un entero.')
    .min(1, 'limit mínimo es 1.')
    .max(50, 'limit máximo es 50.')
    .default(20)
});

export const chatMessageSchema = z
  .object({
    message: z
      .string({ error: 'Escribe tu mensaje.' })
      .trim()
      .min(1, 'Escribe tu mensaje.')
      .max(MAX_CHAT_MESSAGE_LENGTH, `El mensaje no puede superar ${MAX_CHAT_MESSAGE_LENGTH} caracteres.`)
  })
  .strict();
