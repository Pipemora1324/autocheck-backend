import type { Request, Response } from 'express';
import { currentUser } from '../middleware/auth.js';
import type { CardScanService } from '../services/cardScanService.js';
import type { RuntLookupService } from '../services/runtLookupService.js';
import { garagePlateParamsSchema, runtRefreshSchema } from '../validation/garageSchemas.js';

export function createRuntController(runt: RuntLookupService, cardScan: CardScanService) {
  return {
    /** Qué funciones opcionales están activas en este servidor, para que el frontend muestre u oculte botones. */
    capabilities(_request: Request, response: Response): void {
      response.json({ cardScan: { enabled: cardScan.enabled }, runtLookup: runt.status });
    },

    async refresh(request: Request, response: Response): Promise<void> {
      const { plate } = garagePlateParamsSchema.parse(request.params);
      const { ownerDocument } = runtRefreshSchema.parse(request.body);
      response.set('Cache-Control', 'no-store').json(await runt.refresh(currentUser(request).id, plate, ownerDocument));
    }
  };
}
