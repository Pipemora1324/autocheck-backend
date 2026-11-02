import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import {
  CARD_INSTRUCTIONS,
  CardReaderUnavailableError,
  CardScannerBusyError,
  CardUnreadableError,
  rawCardExtractionSchema,
  type CardImage,
  type CardScanner,
  type RawCardExtraction
} from './cardScanner.js';

export interface AnthropicCardScannerOptions {
  apiKey: string;
  model: string;
  /** Inyectable en pruebas para no llamar a la API real. */
  client?: Pick<Anthropic, 'beta'>;
}

export class AnthropicCardScanner implements CardScanner {
  readonly provider = 'anthropic';
  private readonly client: Pick<Anthropic, 'beta'>;

  constructor(private readonly options: AnthropicCardScannerOptions) {
    this.client = options.client ?? new Anthropic({ apiKey: options.apiKey, timeout: 60_000, maxRetries: 1 });
  }

  async read(image: CardImage): Promise<RawCardExtraction> {
    let response;
    try {
      response = await this.client.beta.messages.parse({
        model: this.options.model,
        max_tokens: 8000,
        // Si el modelo declina por sus filtros de seguridad, la API reintenta en el modelo de respaldo recomendado.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium', format: betaZodOutputFormat(rawCardExtractionSchema) },
        system: CARD_INSTRUCTIONS,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data.toString('base64') } },
              { type: 'text', text: 'Extrae los datos de esta licencia de tránsito.' }
            ]
          }
        ]
      });
    } catch (error) {
      // Nunca se registra el contenido de la petición ni de la respuesta: solo el tipo de error.
      if (error instanceof Anthropic.BadRequestError) throw new CardUnreadableError('La API rechazó la imagen.');
      if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
        console.error('Lectura de tarjeta: ANTHROPIC_API_KEY inválida o sin permisos.');
        throw new CardReaderUnavailableError('Credenciales del servicio de visión inválidas.');
      }
      if (error instanceof Anthropic.RateLimitError) throw new CardScannerBusyError('Anthropic respondió 429.');
      if (error instanceof Anthropic.APIError) {
        console.error(`Lectura de tarjeta: error ${error.status ?? 'de conexión'} del servicio de visión.`);
        throw new CardReaderUnavailableError('Servicio de visión no disponible.');
      }
      throw error;
    }

    if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens' || !response.parsed_output) {
      throw new CardUnreadableError(`Lectura no utilizable (${response.stop_reason}).`);
    }
    return response.parsed_output;
  }
}
