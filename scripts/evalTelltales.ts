// Mide el reconocimiento real con fotos locales: npm run eval:telltales.
// Lee ./eval-images (ignorada por Git) y envía cada imagen a Gemini con la GEMINI_API_KEY del .env local.
// Evalúa lo mismo que vería el usuario: la respuesta del modelo pasa por el piso de seguridad del servidor.
// Imprime archivo, resultado, testigos, urgencias y categorías, y solo el tipo de error.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { applySafetyFloor, worstUrgency } from '../src/domain/diagnosisSafety.js';
import { errorMessage } from '../src/errors/httpError.js';
import { detectImageType } from '../src/domain/imageSignature.js';
import { GeminiTelltaleIdentifier } from '../src/services/geminiTelltaleIdentifier.js';
import { TelltaleIdentifierBusyError, type TelltaleIdentifier } from '../src/services/telltaleIdentifier.js';

const EVAL_DIR = 'eval-images';
const DEFAULT_DELAY_MS = 7_000;
const BUSY_WAIT_MS = 60_000;
const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const IMAGE_FILE = /\.(jpe?g|png|webp)$/i;

export interface EvalTelltale {
  nombre: string;
  urgencia: string;
  categoria: string;
  color: string;
  confianza: number;
}

export interface EvalRow {
  archivo: string;
  resultado: string;
  general: string | null;
  mejorFoto: boolean;
  testigos: EvalTelltale[];
}

/** Sin vehículo: la tabla mide solo si reconoce los testigos, sin pistas de marca o combustible. */
const NO_VEHICLE = { brand: 'desconocida', model: 'desconocida', year: null, fuelType: null };

export async function evaluateImage(identifier: TelltaleIdentifier, archivo: string, image: Buffer): Promise<EvalRow> {
  const mediaType = detectImageType(image);
  if (!mediaType)
    return { archivo, resultado: 'error: no es JPEG, PNG ni WEBP', general: null, mejorFoto: false, testigos: [] };

  const reading = await identifier.identify({ image: { data: image, mediaType }, vehicle: NO_VEHICLE });
  const final = reading.testigos.map((telltale) => applySafetyFloor(telltale));
  return {
    archivo,
    resultado: final.length > 0 ? 'ok' : reading.necesitaMejorFoto ? 'pide mejor foto' : 'sin testigos',
    general: final.length > 0 ? worstUrgency(final.map((item) => item.urgencia)) : null,
    mejorFoto: reading.necesitaMejorFoto,
    testigos: final.map(({ nombre, urgencia, categoria, color, confianza }) => ({
      nombre,
      urgencia,
      categoria,
      color,
      confianza
    }))
  };
}

export function formatReport(rows: EvalRow[]): string {
  const blocks = rows.map((row) => {
    const head = `${row.archivo}: ${row.resultado}${row.general ? `, urgencia general ${row.general}` : ''}, ${row.testigos.length} testigos${row.mejorFoto ? ', pide mejor foto' : ''}`;
    const lines = row.testigos.map(
      (item) =>
        `  - ${item.nombre} | ${item.urgencia} | ${item.categoria} | color ${item.color} | confianza ${item.confianza.toFixed(2)}`
    );
    return [head, ...lines].join('\n');
  });
  const withTelltales = rows.filter((row) => row.testigos.length > 0).length;
  const errors = rows.filter((row) => row.resultado.startsWith('error')).length;
  return [...blocks, '', `Con testigos: ${withTelltales} de ${rows.length}. Con error: ${errors}.`].join('\n');
}

export interface RunOptions {
  delayMs: number;
  busyWaitMs?: number;
  wait?: (ms: number) => Promise<unknown>;
  log?: (message: string) => void;
}

/** Espera entre llamadas para respetar el plan gratuito. Si el proveedor está ocupado, espera y reintenta una vez. */
export async function runEvaluation(
  identifier: TelltaleIdentifier,
  files: string[],
  readImage: (archivo: string) => Buffer,
  options: RunOptions
): Promise<EvalRow[]> {
  const { delayMs, busyWaitMs = BUSY_WAIT_MS, wait = sleep, log = () => {} } = options;
  const rows: EvalRow[] = [];
  const failed = (archivo: string, reason: string): EvalRow => ({
    archivo,
    resultado: `error: ${reason}`,
    general: null,
    mejorFoto: false,
    testigos: []
  });

  for (const [index, archivo] of files.entries()) {
    log(`[${index + 1}/${files.length}] ${archivo}`);
    if (index > 0) await wait(delayMs);
    const image = readImage(archivo);
    try {
      rows.push(await evaluateImage(identifier, archivo, image));
    } catch (error) {
      if (!(error instanceof TelltaleIdentifierBusyError)) {
        // Solo el tipo de error: nunca el cuerpo de la petición ni cabeceras.
        rows.push(failed(archivo, (error as Error).constructor.name));
        continue;
      }
      log(`  El proveedor está ocupado. Se reintenta en ${Math.round(busyWaitMs / 1000)} s.`);
      await wait(busyWaitMs);
      try {
        rows.push(await evaluateImage(identifier, archivo, image));
      } catch (retryError) {
        rows.push(
          failed(
            archivo,
            retryError instanceof TelltaleIdentifierBusyError
              ? 'proveedor ocupado'
              : (retryError as Error).constructor.name
          )
        );
      }
    }
  }
  return rows;
}

function main(): void {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Falta GEMINI_API_KEY en el .env local.');
  if (!existsSync(EVAL_DIR))
    throw new Error(`No existe ${EVAL_DIR}. Crea la carpeta y copia ahí tus fotos (ver el README).`);
  const files = readdirSync(EVAL_DIR)
    .filter((file) => IMAGE_FILE.test(file))
    .sort();
  if (files.length === 0) throw new Error(`${EVAL_DIR} no tiene imágenes.`);

  const delayMs = Number(process.env.EVAL_DELAY_MS ?? DEFAULT_DELAY_MS);
  if (!Number.isFinite(delayMs) || delayMs < 0) throw new Error('EVAL_DELAY_MS debe ser un número de milisegundos.');

  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const identifier = new GeminiTelltaleIdentifier({ apiKey, model });
  console.log(
    `Evaluando ${files.length} imágenes con ${model}, ${delayMs / 1000} s entre llamadas. Se envían a Gemini: usa solo fotos que puedas compartir.\n`
  );
  runEvaluation(identifier, files, (archivo) => readFileSync(path.join(EVAL_DIR, archivo)), {
    delayMs,
    log: console.log
  })
    .then((rows) => {
      console.log(`\n${formatReport(rows)}`);
    })
    .catch((error: unknown) => {
      console.error(errorMessage(error));
      process.exitCode = 1;
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}
