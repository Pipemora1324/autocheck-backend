// Comprueba qué modelos responden con la clave local: npm run smoke:gemini.
// Imprime solo el nombre del modelo, el código HTTP y el tipo de error del proveedor. Nunca la clave ni los cuerpos.
// Usa la primera imagen de ./eval-images; sin fotos, una imagen sintética que prueba el modelo pero no el reconocimiento.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';
import { detectImageType } from '../src/domain/imageSignature.js';
import { errorMessage } from '../src/errors/httpError.js';
import { GEMINI_API_REVISION, GEMINI_INTERACTIONS_URL } from '../src/services/geminiClient.js';

const MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const EVAL_DIR = 'eval-images';
const DELAY_MS = 7_000;
const TIMEOUT_MS = 45_000;
const MAX_CANDIDATES = 8;
const NOT_VISION =
  /embedding|tts|audio|image|banana|transcribe|robotics|computer-use|live|aqa|learnlm|deep-research|customtools/i;

export interface ListedModel {
  name: string;
  supportedGenerationMethods?: string[];
}

/** Modelos gemini que generan contenido y aceptan imágenes, con los "lite" y los preview al final. */
export function pickCandidates(models: ListedModel[]): string[] {
  const rank = (name: string) => (/lite/i.test(name) ? 2 : 0) + (/preview|exp/i.test(name) ? 1 : 0);
  return models
    .filter((model) => model.supportedGenerationMethods?.includes('generateContent'))
    .map((model) => model.name.replace(/^models\//, ''))
    .filter((name) => name.startsWith('gemini') && !NOT_VISION.test(name))
    .sort((a, b) => rank(a) - rank(b) || b.localeCompare(a));
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

const crc32 = (data: Buffer) => {
  let c = 0xffffffff;
  for (const byte of data) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const pngChunk = (type: string, data: Buffer) => {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

/** PNG de un color: basta para saber si el modelo acepta imágenes. */
export function syntheticPng(size = 64): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, Buffer.from([200, 30, 30]))]);
  const pixels = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(pixels)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function testImage(): { data: Buffer; mediaType: string; origen: string } {
  if (existsSync(EVAL_DIR)) {
    for (const file of readdirSync(EVAL_DIR).sort()) {
      const full = path.join(EVAL_DIR, file);
      if (!/\.(jpe?g|png|webp)$/i.test(file)) continue;
      const data = readFileSync(full);
      const mediaType = detectImageType(data);
      if (mediaType) return { data, mediaType, origen: `foto de ${EVAL_DIR}` };
    }
  }
  return { data: syntheticPng(), mediaType: 'image/png', origen: 'imagen sintética (sin fotos en eval-images)' };
}

interface ProviderErrorBody {
  error?: {
    status?: string;
    code?: string | number;
    details?: Array<{ violations?: Array<{ quotaId?: string }>; retryDelay?: string }>;
  };
}

/** Solo el tipo de error y, en un 429, qué cuota se agotó y cuánto esperar. Nunca el mensaje completo. */
export function describeProviderError(body: ProviderErrorBody): string {
  const details = body.error?.details ?? [];
  const quotas = details
    .flatMap((detail) => detail.violations ?? [])
    .flatMap((violation) => (violation.quotaId ? [violation.quotaId] : []));
  const retry = details.find((detail) => detail.retryDelay)?.retryDelay;
  return [
    body.error?.status ?? body.error?.code ?? '-',
    ...new Set(quotas),
    ...(retry ? [`reintentar en ${retry}`] : [])
  ].join(' ');
}

const providerStatus = async (response: Response): Promise<string> => {
  try {
    return describeProviderError((await response.json()) as ProviderErrorBody);
  } catch {
    return '-';
  }
};

async function listModels(apiKey: string): Promise<ListedModel[]> {
  const models: ListedModel[] = [];
  let pageToken = '';
  do {
    const url = `${MODELS_URL}?pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const response = await fetch(url, {
      headers: { 'x-goog-api-key': apiKey },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!response.ok) throw new Error(`models.list respondió ${response.status} (${await providerStatus(response)}).`);
    const body = (await response.json()) as { models?: ListedModel[]; nextPageToken?: string };
    models.push(...(body.models ?? []));
    pageToken = body.nextPageToken ?? '';
  } while (pageToken);
  return models;
}

async function probe(apiKey: string, model: string, image: { data: Buffer; mediaType: string }): Promise<string> {
  try {
    const response = await fetch(GEMINI_INTERACTIONS_URL, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json', 'api-revision': GEMINI_API_REVISION },
      body: JSON.stringify({
        model,
        input: [
          { type: 'text', text: 'Responde en JSON: ¿es esta imagen un tablero de vehículo?' },
          { type: 'image', data: image.data.toString('base64'), mime_type: image.mediaType }
        ],
        response_format: {
          type: 'text',
          mime_type: 'application/json',
          schema: { type: 'object', properties: { esTablero: { type: 'boolean' } }, required: ['esTablero'] }
        }
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    return `${response.status} ${response.ok ? 'OK' : await providerStatus(response)}`;
  } catch (error) {
    return `sin respuesta (${(error as Error).name})`;
  }
}

async function probeGenerateContent(
  apiKey: string,
  model: string,
  image: { data: Buffer; mediaType: string }
): Promise<string> {
  try {
    const response = await fetch(`${MODELS_URL}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: 'Responde en JSON: ¿es esta imagen un tablero de vehículo?' },
              { inlineData: { mimeType: image.mediaType, data: image.data.toString('base64') } }
            ]
          }
        ],
        generationConfig: { responseMimeType: 'application/json' }
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    return `${response.status} ${response.ok ? 'OK' : await providerStatus(response)}`;
  } catch (error) {
    return `sin respuesta (${(error as Error).name})`;
  }
}

async function main(): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Falta GEMINI_API_KEY en el .env local.');

  // Con argumentos se prueban esos modelos: npm run smoke:gemini -- gemini-2.5-flash gemini-3.5-flash
  const requested = process.argv.slice(2);
  const models = await listModels(apiKey);
  const candidates = pickCandidates(models);
  console.log(`models.list: ${models.length} modelos, ${candidates.length} candidatos con generateContent y visión:`);
  for (const name of candidates) console.log(`  ${name}`);

  const image = testImage();
  const tested = requested.length > 0 ? requested : candidates.slice(0, MAX_CANDIDATES);
  console.log(`\nProbando ${tested.length} con ${image.origen}, ${DELAY_MS / 1000} s entre llamadas:`);
  for (const [index, name] of tested.entries()) {
    if (index > 0) await sleep(DELAY_MS);
    console.log(`  ${name}`);
    console.log(`    interactions     ${await probe(apiKey, name, image)}`);
    await sleep(DELAY_MS);
    console.log(`    generateContent  ${await probeGenerateContent(apiKey, name, image)}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(errorMessage(error));
    process.exitCode = 1;
  });
}
