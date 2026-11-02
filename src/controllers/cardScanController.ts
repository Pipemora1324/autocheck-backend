import type { Request, RequestHandler, Response } from 'express';
import multer from 'multer';
import { badRequest } from '../errors/httpError.js';
import type { CardScanService } from '../services/cardScanService.js';

export const MAX_CARD_IMAGE_BYTES = 5 * 1024 * 1024;

/** Imagen en memoria (nunca en disco), un solo archivo en el campo "image", máximo 5 MB. */
export const cardImageUpload: RequestHandler = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_CARD_IMAGE_BYTES, files: 1, fields: 0, parts: 1 }
}).single('image');

export function createCardScanController(service: CardScanService) {
  return {
    async scan(request: Request, response: Response): Promise<void> {
      if (!request.file) throw badRequest('Adjunta la foto de la tarjeta en el campo "image" (multipart/form-data).', { code: 'IMAGE_REQUIRED' });
      const image = request.file.buffer;
      // Se suelta la referencia para que la imagen no viva más allá del procesamiento.
      request.file.buffer = Buffer.alloc(0);
      response.set('Cache-Control', 'no-store').json(await service.scan(image));
    }
  };
}
