import type { AppConfig } from '../config/env.js';
import { GeminiBusyError, GeminiClient, GeminiUnavailableError, GeminiUnusableOutputError, type GeminiClientOptions, type GeminiInputPart } from './geminiClient.js';
import {
  TELLTALE_INSTRUCTIONS,
  telltaleIdentificationSchema,
  TelltaleIdentifierBusyError,
  TelltaleIdentifierUnavailableError,
  TelltaleIdentifierUnusableError,
  telltaleUserPrompt,
  type TelltaleIdentification,
  type TelltaleIdentifier,
  type TelltaleInput
} from './telltaleIdentifier.js';

/** El mismo contrato que telltaleIdentificationSchema, en el subconjunto de JSON Schema que admite Gemini. */
export const TELLTALE_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    telltaleId: { type: ['string', 'null'] },
    nombreDetectado: { type: ['string', 'null'] },
    confianza: { type: 'number', minimum: 0, maximum: 1 },
    notaEspecificaDelVehiculo: { type: ['string', 'null'] },
    pideMejorEntrada: { type: 'boolean' }
  },
  required: ['telltaleId', 'nombreDetectado', 'confianza', 'pideMejorEntrada'],
  additionalProperties: false
};

export class GeminiTelltaleIdentifier implements TelltaleIdentifier {
  readonly provider = 'gemini';
  private readonly client: GeminiClient;

  constructor(options: GeminiClientOptions) {
    this.client = new GeminiClient(options);
  }

  async identify({ image, description, vehicle }: TelltaleInput): Promise<TelltaleIdentification> {
    const input: GeminiInputPart[] = [{ type: 'text', text: `${TELLTALE_INSTRUCTIONS}\n\n${telltaleUserPrompt({ description, vehicle })}` }];
    if (image) input.push({ type: 'image', data: image.data.toString('base64'), mime_type: image.mediaType });

    let json: unknown;
    try {
      json = await this.client.generateJson(input, TELLTALE_RESPONSE_SCHEMA);
    } catch (error) {
      if (error instanceof GeminiBusyError) throw new TelltaleIdentifierBusyError(error.message);
      if (error instanceof GeminiUnavailableError) throw new TelltaleIdentifierUnavailableError(error.message);
      if (error instanceof GeminiUnusableOutputError) throw new TelltaleIdentifierUnusableError(error.message);
      throw error;
    }

    const parsed = telltaleIdentificationSchema.safeParse(json);
    if (!parsed.success) throw new TelltaleIdentifierUnusableError('La salida de Gemini no cumple el esquema.');
    return parsed.data;
  }
}

/** null si SCAN_PROVIDER no es gemini o falta la clave: el diagnóstico con IA responde 503 y la elección manual sigue activa. */
export function createTelltaleIdentifier(config: AppConfig['scan']): TelltaleIdentifier | null {
  return config.provider === 'gemini' ? new GeminiTelltaleIdentifier(config) : null;
}
