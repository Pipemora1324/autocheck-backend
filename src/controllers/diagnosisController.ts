import type { Request, RequestHandler, Response } from 'express';
import multer from 'multer';
import { currentUser } from '../middleware/auth.js';
import type { DiagnosisService } from '../services/diagnosisService.js';
import { diagnosisHistoryQuerySchema, diagnosisIdParamsSchema, diagnosisInputSchema } from '../validation/diagnosisSchemas.js';
import { garagePlateParamsSchema } from '../validation/garageSchemas.js';
import { MAX_CARD_IMAGE_BYTES } from './cardScanController.js';

// Suficiente para 500 caracteres en cualquier codificación UTF-8. El límite real de caracteres lo aplica zod.
const MAX_TEXT_FIELD_BYTES = 4 * 1024;

/** Foto opcional en memoria (nunca en disco), en el campo "image", con description y telltaleId como campos de texto. */
export const diagnosisUpload: RequestHandler = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_CARD_IMAGE_BYTES, files: 1, fields: 2, parts: 3, fieldSize: MAX_TEXT_FIELD_BYTES }
}).single('image');

export function createDiagnosisController(service: DiagnosisService) {
  return {
    async create(request: Request, response: Response): Promise<void> {
      const { plate } = garagePlateParamsSchema.parse(request.params);
      const { description, telltaleId } = diagnosisInputSchema.parse(request.body ?? {});
      const image = request.file?.buffer;
      // Se suelta la referencia para que la imagen no viva más allá del procesamiento.
      if (request.file) request.file.buffer = Buffer.alloc(0);

      const result = await service.diagnose(currentUser(request).id, plate, {
        ...(image ? { image } : {}),
        ...(description ? { description } : {}),
        ...(telltaleId ? { telltaleId } : {})
      });
      response.set('Cache-Control', 'no-store').status(result.status === 'diagnosed' ? 201 : 200).json(result);
    },

    async list(request: Request, response: Response): Promise<void> {
      const { plate } = garagePlateParamsSchema.parse(request.params);
      const { page, limit } = diagnosisHistoryQuerySchema.parse(request.query);
      response.set('Cache-Control', 'no-store').json(await service.list(currentUser(request).id, plate, page, limit));
    },

    async remove(request: Request, response: Response): Promise<void> {
      const { plate, id } = diagnosisIdParamsSchema.parse(request.params);
      await service.remove(currentUser(request).id, plate, id);
      response.status(204).end();
    }
  };
}
