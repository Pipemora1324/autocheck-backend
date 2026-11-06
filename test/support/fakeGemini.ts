import { randomBytes } from 'node:crypto';
import { GeminiChatResponder } from '../../src/services/diagnosisChat.js';
import { GeminiTelltaleIdentifier } from '../../src/services/geminiTelltaleIdentifier.js';

// Generada en cada corrida para no dejar valores con forma de clave en el repositorio.
const GEMINI_KEY = randomBytes(16).toString('hex');
export const PROVIDER_DETAIL = 'detalle-del-proveedor';

/** Fetch simulado con el formato "steps" de la Interactions API de Gemini: las pruebas ejercitan el cliente real. */
export class FakeGemini {
  readonly calls: any[] = [];
  status = 200;
  /** Texto crudo que devuelve el modelo. */
  output = '';

  answer(body: Record<string, unknown>) {
    this.status = 200;
    this.output = JSON.stringify(body);
  }

  readonly fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    this.calls.push(JSON.parse(String(init!.body)));
    const body = this.status === 200
      ? { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: this.output }] }] }
      : { error: { message: PROVIDER_DETAIL } };
    return new Response(JSON.stringify(body), { status: this.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  private readonly options = { apiKey: GEMINI_KEY, model: 'modelo-de-prueba', fetchImpl: this.fetchImpl, retryDelaysMs: [] };
  readonly identifier = new GeminiTelltaleIdentifier(this.options);
  readonly chat = new GeminiChatResponder(this.options);
}

/** Un testigo tal como lo devolvería el modelo. */
export const modelTelltale = (overrides: Record<string, unknown> = {}) => ({
  nombre: 'Testigo de motor',
  descripcionSimbolo: 'Silueta de un motor, abajo a la izquierda.',
  color: 'amarillo',
  parpadeando: null,
  categoria: 'motor_emisiones',
  urgencia: 'amarillo',
  significado: 'Indica una falla en el motor o en las emisiones.',
  porQuePasa: ['Sensor dañado'],
  puedesRevisar: ['Mira si la tapa del combustible está bien cerrada.'],
  noHagas: ['No ignores el testigo por semanas.'],
  cuandoIrAlMecanico: 'En los próximos días, para leer el código de falla.',
  notaDelVehiculo: null,
  confianza: 0.9,
  ...overrides
});

export const reading = (testigos: Array<Record<string, unknown>> = [modelTelltale()], overrides: Record<string, unknown> = {}) => ({
  testigos,
  mensajeGeneral: 'Se ve un testigo encendido.',
  necesitaMejorFoto: false,
  motivoMejorFoto: null,
  ...overrides
});
