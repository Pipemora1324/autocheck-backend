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

// Gemini API (Google AI Studio), Interactions API. Contrato verificado el 2026-11-02 en
// aistudio.google.com/docs/image-understanding, /docs/structured-output y la guía de cambios de mayo de 2026:
//   POST /v1beta/interactions, cabecera x-goog-api-key, body { model, input: [{type:"text"}, {type:"image", data, mime_type}],
//   response_format: { type: "text", mime_type: "application/json", schema } }.
//   Respuesta: steps[] con type "model_output" y content[] con type "text".
export const GEMINI_INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
export const GEMINI_API_REVISION = '2026-05-20';
const GEMINI_TIMEOUT_MS = 30_000;

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

interface InteractionResponse {
  status?: string;
  steps?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
}

export interface GeminiCardScannerOptions {
  apiKey: string;
  model: string;
  /** Inyectable en pruebas para no llamar a la API real. */
  fetchImpl?: typeof fetch;
}

export class GeminiCardScanner implements CardScanner {
  readonly provider = 'gemini';
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: GeminiCardScannerOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async read(image: CardImage): Promise<RawCardExtraction> {
    let response: Response;
    try {
      response = await this.fetchImpl(GEMINI_INTERACTIONS_URL, {
        method: 'POST',
        headers: {
          'x-goog-api-key': this.options.apiKey,
          'content-type': 'application/json',
          'api-revision': GEMINI_API_REVISION
        },
        body: JSON.stringify({
          model: this.options.model,
          input: [
            { type: 'text', text: `${CARD_INSTRUCTIONS}\n\nExtrae los datos de esta licencia de tránsito.` },
            { type: 'image', data: image.data.toString('base64'), mime_type: image.mediaType }
          ],
          response_format: { type: 'text', mime_type: 'application/json', schema: GEMINI_RESPONSE_SCHEMA }
        }),
        signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS)
      });
    } catch (error) {
      console.error(`Lectura de tarjeta: Gemini no respondió (${(error as Error).name}).`);
      throw new CardReaderUnavailableError('Gemini no respondió.');
    }

    // Nunca se registra el cuerpo (ni de la petición ni de la respuesta): solo el código de estado.
    if (response.status === 429) throw new CardScannerBusyError('Gemini respondió 429.');
    if (response.status === 400) throw new CardUnreadableError('Gemini rechazó la imagen.');
    if (response.status === 401 || response.status === 403) {
      console.error('Lectura de tarjeta: GEMINI_API_KEY inválida o sin permisos.');
      throw new CardReaderUnavailableError('Credenciales de Gemini inválidas.');
    }
    if (!response.ok) {
      console.error(`Lectura de tarjeta: error ${response.status} de Gemini.`);
      throw new CardReaderUnavailableError(`Gemini respondió ${response.status}.`);
    }

    let body: InteractionResponse;
    try {
      body = (await response.json()) as InteractionResponse;
    } catch {
      throw new CardUnreadableError('Respuesta de Gemini no es JSON.');
    }

    const text = (body.steps ?? [])
      .filter((step) => step.type === 'model_output')
      .flatMap((step) => step.content ?? [])
      .filter((part) => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('');
    if (!text) throw new CardUnreadableError(`Gemini no devolvió texto (${body.status ?? 'sin estado'}).`);

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new CardUnreadableError('La salida de Gemini no es JSON válido.');
    }
    const parsed = rawCardExtractionSchema.safeParse(json);
    if (!parsed.success) throw new CardUnreadableError('La salida de Gemini no cumple el esquema.');
    return parsed.data;
  }
}
