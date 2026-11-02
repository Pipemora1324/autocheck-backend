import type { Request, Response } from 'express';
import { currentUser } from '../middleware/auth.js';
import type { CardScanService } from '../services/cardScanService.js';
import { PRIVACY_POLICY_VERSION, REGISTRATION_CONSENT_TEXT, scanProviderNotice } from '../services/privacyPolicy.js';
import type { RuntLookupService } from '../services/runtLookupService.js';
import { garagePlateParamsSchema, runtRefreshSchema } from '../validation/garageSchemas.js';

const cardScanStatus = (cardScan: CardScanService) => ({
  enabled: cardScan.enabled,
  provider: cardScan.provider,
  notice: scanProviderNotice(cardScan.provider)
});

export function createRuntController(runt: RuntLookupService, cardScan: CardScanService) {
  return {
    /** Qué funciones opcionales están activas en este servidor, para que el frontend muestre u oculte botones. */
    capabilities(_request: Request, response: Response): void {
      response.json({ cardScan: cardScanStatus(cardScan), runtLookup: runt.status });
    },

    /** GET /config/public (sin sesión): texto de consentimiento y avisos para mostrar antes de registrarse o subir la foto. */
    publicConfig(_request: Request, response: Response): void {
      response.json({
        privacyPolicy: { version: PRIVACY_POLICY_VERSION, registrationConsent: REGISTRATION_CONSENT_TEXT },
        cardScan: cardScanStatus(cardScan),
        runtLookup: runt.status
      });
    },

    async refresh(request: Request, response: Response): Promise<void> {
      const { plate } = garagePlateParamsSchema.parse(request.params);
      const { ownerDocument } = runtRefreshSchema.parse(request.body);
      response.set('Cache-Control', 'no-store').json(await runt.refresh(currentUser(request).id, plate, ownerDocument));
    }
  };
}
