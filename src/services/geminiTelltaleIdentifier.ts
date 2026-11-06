import type { AppConfig } from '../config/env.js';
import {
  GeminiBusyError,
  GeminiClient,
  GeminiUnavailableError,
  GeminiUnusableOutputError,
  type GeminiClientOptions,
  type GeminiInputPart
} from './geminiClient.js';
import {
  dashboardReadingSchema,
  MAX_TELLTALES_PER_PHOTO,
  OBSERVED_COLORS,
  TELLTALE_CATEGORIES,
  TELLTALE_INSTRUCTIONS,
  TelltaleIdentifierBusyError,
  TelltaleIdentifierUnavailableError,
  TelltaleIdentifierUnusableError,
  telltaleUserPrompt,
  URGENCIES,
  type DashboardReading,
  type TelltaleIdentifier,
  type TelltaleInput
} from './telltaleIdentifier.js';

const stringList = { type: 'array', items: { type: 'string' } };

/** El mismo contrato que dashboardReadingSchema, en el subconjunto de JSON Schema que admite Gemini. */
export const TELLTALE_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    testigos: {
      type: 'array',
      maxItems: MAX_TELLTALES_PER_PHOTO,
      items: {
        type: 'object',
        properties: {
          nombre: { type: 'string' },
          descripcionSimbolo: { type: 'string' },
          color: { type: 'string', enum: [...OBSERVED_COLORS] },
          parpadeando: { type: ['boolean', 'null'] },
          categoria: { type: 'string', enum: [...TELLTALE_CATEGORIES] },
          urgencia: { type: 'string', enum: [...URGENCIES] },
          significado: { type: 'string' },
          porQuePasa: stringList,
          puedesRevisar: stringList,
          noHagas: stringList,
          cuandoIrAlMecanico: { type: 'string' },
          notaDelVehiculo: { type: ['string', 'null'] },
          confianza: { type: 'number', minimum: 0, maximum: 1 }
        },
        required: [
          'nombre',
          'descripcionSimbolo',
          'color',
          'parpadeando',
          'categoria',
          'urgencia',
          'significado',
          'porQuePasa',
          'puedesRevisar',
          'noHagas',
          'cuandoIrAlMecanico',
          'confianza'
        ]
      }
    },
    mensajeGeneral: { type: 'string' },
    necesitaMejorFoto: { type: 'boolean' },
    motivoMejorFoto: { type: ['string', 'null'] }
  },
  required: ['testigos', 'mensajeGeneral', 'necesitaMejorFoto']
};

export class GeminiTelltaleIdentifier implements TelltaleIdentifier {
  readonly provider = 'gemini';
  private readonly client: GeminiClient;

  constructor(options: GeminiClientOptions) {
    this.client = new GeminiClient(options);
  }

  async identify({ image, description, blinking, vehicle }: TelltaleInput): Promise<DashboardReading> {
    const input: GeminiInputPart[] = [
      { type: 'text', text: `${TELLTALE_INSTRUCTIONS}\n\n${telltaleUserPrompt({ description, blinking, vehicle })}` }
    ];
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

    const parsed = dashboardReadingSchema.safeParse(json);
    if (!parsed.success) throw new TelltaleIdentifierUnusableError('La salida de Gemini no cumple el esquema.');
    return parsed.data;
  }
}

/** null si SCAN_PROVIDER no es gemini o falta la clave: el diagnóstico con IA responde 503 y la elección manual sigue activa. */
export function createTelltaleIdentifier(config: AppConfig['scan']): TelltaleIdentifier | null {
  return config.provider === 'gemini' ? new GeminiTelltaleIdentifier(config) : null;
}
