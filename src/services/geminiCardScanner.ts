import {
  CARD_FIELDS,
  CARD_INSTRUCTIONS,
  CardReaderUnavailableError,
  CardScannerBusyError,
  CardUnreadableError,
  rawCardExtractionSchema,
  type CardImage,
  type CardScanner,
  type RawCardExtraction
} from './cardScanner.js';
import { GeminiBusyError, GeminiClient, GeminiUnavailableError, GeminiUnusableOutputError, type GeminiClientOptions } from './geminiClient.js';

const nullableField = {
  type: 'object',
  properties: { value: { type: ['string', 'null'] }, confidence: { type: 'number', minimum: 0, maximum: 1 } },
  required: ['value', 'confidence'],
  additionalProperties: false
} as const;

/** El mismo contrato que rawCardExtractionSchema, en el subconjunto de JSON Schema que admite Gemini. */
export const GEMINI_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    isVehicleDocument: { type: 'boolean' },
    ...Object.fromEntries(CARD_FIELDS.map((name) => [name, nullableField])),
    warnings: { type: 'array', items: { type: 'string' } }
  },
  required: ['isVehicleDocument', ...CARD_FIELDS, 'warnings'],
  additionalProperties: false
};

export class GeminiCardScanner implements CardScanner {
  readonly provider = 'gemini';
  private readonly client: GeminiClient;

  constructor(options: GeminiClientOptions) {
    this.client = new GeminiClient(options);
  }

  async read(image: CardImage): Promise<RawCardExtraction> {
    let json: unknown;
    try {
      json = await this.client.generateJson(
        [
          { type: 'text', text: `${CARD_INSTRUCTIONS}\n\nExtrae los datos de esta licencia de tránsito.` },
          { type: 'image', data: image.data.toString('base64'), mime_type: image.mediaType }
        ],
        GEMINI_RESPONSE_SCHEMA
      );
    } catch (error) {
      if (error instanceof GeminiBusyError) throw new CardScannerBusyError(error.message);
      if (error instanceof GeminiUnavailableError) throw new CardReaderUnavailableError(error.message);
      if (error instanceof GeminiUnusableOutputError) throw new CardUnreadableError(error.message);
      throw error;
    }

    const parsed = rawCardExtractionSchema.safeParse(json);
    if (!parsed.success) throw new CardUnreadableError('La salida de Gemini no cumple el esquema.');
    return parsed.data;
  }
}
