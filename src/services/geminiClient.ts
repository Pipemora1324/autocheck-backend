// Gemini API (Google AI Studio), Interactions API. Contrato verificado el 2026-11-02 en
// aistudio.google.com/docs/image-understanding, /docs/structured-output y la guía de cambios de mayo de 2026,
// y comprobado con la API real el 2026-11-05 (npm run smoke:gemini):
//   POST /v1beta/interactions, cabecera x-goog-api-key, body { model, input: [{type:"text"}, {type:"image", data, mime_type}],
//   response_format: { type: "text", mime_type: "application/json", schema } }.
//   Respuesta: steps[] con type "model_output" y content[] con type "text".
import { setTimeout as sleep } from 'node:timers/promises';

export const GEMINI_INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
export const GEMINI_API_REVISION = '2026-05-20';
const GEMINI_TIMEOUT_MS = 30_000;
/** Los 503 de Gemini son frecuentes e intermitentes: en la prueba real, la misma foto falló y luego pasó. */
const DEFAULT_RETRY_DELAYS_MS = [1_500, 4_000];

export type GeminiInputPart = { type: 'text'; text: string } | { type: 'image'; data: string; mime_type: string };

/** Gemini respondió 429: cuota del plan gratuito agotada o servicio saturado. */
export class GeminiBusyError extends Error {}

/** Gemini no está disponible: clave inválida, caída del proveedor o tiempo agotado. */
export class GeminiUnavailableError extends Error {}

/** Gemini rechazó la entrada o no devolvió un JSON utilizable. */
export class GeminiUnusableOutputError extends Error {}

export interface GeminiClientOptions {
  apiKey: string;
  model: string;
  /** Inyectable en pruebas para no llamar a la API real. */
  fetchImpl?: typeof fetch;
  /** Espera antes de cada reintento ante un 5xx. Vacío: sin reintentos. */
  retryDelaysMs?: readonly number[];
}

interface InteractionResponse {
  status?: string;
  steps?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
}

/** Solo el tipo de error del proveedor: su mensaje podría repetir datos del usuario. */
const providerErrorType = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as { error?: { status?: unknown; code?: unknown } };
    const type = body.error?.status ?? body.error?.code;
    return typeof type === 'string' && /^[\w.-]{1,40}$/.test(type) ? type : 'sin tipo';
  } catch {
    return 'sin tipo';
  }
};

export class GeminiClient {
  private readonly fetchImpl: typeof fetch;
  private readonly retryDelaysMs: readonly number[];

  constructor(private readonly options: GeminiClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  }

  /** Devuelve el JSON del modelo, sin validar: cada llamador lo valida con su esquema zod. */
  async generateJson(input: GeminiInputPart[], schema: object): Promise<unknown> {
    const request = JSON.stringify({
      model: this.options.model,
      input,
      response_format: { type: 'text', mime_type: 'application/json', schema }
    });

    let response = await this.send(request);
    for (const delay of this.retryDelaysMs) {
      if (response.status < 500) break;
      console.warn(`Gemini respondió ${response.status}: se reintenta.`);
      await sleep(delay);
      response = await this.send(request);
    }

    // Nunca se registra el cuerpo (ni de la petición ni de la respuesta): solo el código de estado y el tipo de error.
    if (response.status === 429) throw new GeminiBusyError('Gemini respondió 429.');
    if (response.status === 400) {
      console.error(`Gemini rechazó la petición: 400 (${await providerErrorType(response)}).`);
      throw new GeminiUnusableOutputError('Gemini rechazó la entrada.');
    }
    if (response.status === 401 || response.status === 403) {
      console.error('GEMINI_API_KEY inválida o sin permisos.');
      throw new GeminiUnavailableError('Credenciales de Gemini inválidas.');
    }
    if (!response.ok) {
      console.error(`Error ${response.status} de Gemini (${await providerErrorType(response)}).`);
      throw new GeminiUnavailableError(`Gemini respondió ${response.status}.`);
    }

    let body: InteractionResponse;
    try {
      body = (await response.json()) as InteractionResponse;
    } catch {
      throw new GeminiUnusableOutputError('Respuesta de Gemini no es JSON.');
    }

    const text = (body.steps ?? [])
      .filter((step) => step.type === 'model_output')
      .flatMap((step) => step.content ?? [])
      .filter((part) => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('');
    if (!text) throw new GeminiUnusableOutputError(`Gemini no devolvió texto (${body.status ?? 'sin estado'}).`);

    try {
      return JSON.parse(text);
    } catch {
      throw new GeminiUnusableOutputError('La salida de Gemini no es JSON válido.');
    }
  }

  private async send(body: string): Promise<Response> {
    try {
      return await this.fetchImpl(GEMINI_INTERACTIONS_URL, {
        method: 'POST',
        headers: {
          'x-goog-api-key': this.options.apiKey,
          'content-type': 'application/json',
          'api-revision': GEMINI_API_REVISION
        },
        body,
        signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS)
      });
    } catch (error) {
      console.error(`Gemini no respondió (${(error as Error).name}).`);
      throw new GeminiUnavailableError('Gemini no respondió.');
    }
  }
}
