import type { Request, Response } from 'express';
import type { CardScanService } from '../services/cardScanService.js';
import type { DiagnosisService } from '../services/diagnosisService.js';
import {
  diagnosisProviderNotice,
  PRIVACY_POLICY_VERSION,
  REGISTRATION_CONSENT_TEXT,
  scanProviderNotice
} from '../services/privacyPolicy.js';

const cardScanStatus = (cardScan: CardScanService) => ({
  enabled: cardScan.enabled,
  provider: cardScan.provider,
  notice: scanProviderNotice(cardScan.provider)
});

/** enabled se refiere a la IA: elegir el testigo de la lista siempre funciona. */
const diagnosisStatus = (diagnosis: DiagnosisService) => ({
  enabled: diagnosis.enabled,
  provider: diagnosis.provider,
  manualSelection: true,
  notice: diagnosisProviderNotice(diagnosis.provider)
});

export function createConfigController(cardScan: CardScanService, diagnosis: DiagnosisService) {
  return {
    /** Qué funciones opcionales están activas en este servidor, para que el frontend muestre u oculte botones. */
    capabilities: (_request: Request, response: Response): void => {
      response.json({ cardScan: cardScanStatus(cardScan), diagnosis: diagnosisStatus(diagnosis) });
    },

    /** GET /config/public (sin sesión): texto de consentimiento y avisos para mostrar antes de registrarse o subir la foto. */
    publicConfig: (_request: Request, response: Response): void => {
      response.json({
        privacyPolicy: { version: PRIVACY_POLICY_VERSION, registrationConsent: REGISTRATION_CONSENT_TEXT },
        cardScan: cardScanStatus(cardScan),
        diagnosis: diagnosisStatus(diagnosis)
      });
    }
  };
}
