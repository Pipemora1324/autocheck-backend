// Mide el reconocimiento real con fotos locales: npm run eval:telltales.
// Lee ./eval-images (ignorada por Git) y envía cada imagen a Gemini con la GEMINI_API_KEY del .env local.
// Evalúa lo mismo que vería el usuario: la respuesta del modelo pasa por la validación cruzada del servidor.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { findTelltale } from '../src/data/telltales.js';
import { detectImageType } from '../src/domain/imageSignature.js';
import { evaluateIdentification } from '../src/services/diagnosisService.js';
import { GeminiTelltaleIdentifier } from '../src/services/geminiTelltaleIdentifier.js';
import { OBSERVED_COLORS, TelltaleIdentifierBusyError, type TelltaleIdentifier } from '../src/services/telltaleIdentifier.js';

const EVAL_DIR = 'eval-images';
const DEFAULT_DELAY_MS = 7_000;
const BUSY_WAIT_MS = 60_000;
const DEFAULT_MODEL = 'gemini-3.5-flash';
/** En expected.csv, la imagen no permite identificar el testigo: lo correcto es pedir otra entrada. */
const EXPECT_NONE = 'ninguno';
const ASKS_BETTER_INPUT = 'pide mejor entrada';

export interface EvalCase {
  archivo: string;
  esperado: string;
  color: string | null;
  parpadea: boolean | null;
}

export interface EvalRow {
  archivo: string;
  esperado: string;
  obtenido: string;
  confianza: number | null;
  acierto: boolean;
  /** null si expected.csv no indica el valor esperado. */
  colorCorrecto: boolean | null;
  parpadeoCorrecto: boolean | null;
}

const parseBlink = (value: string, line: number): boolean | null => {
  const normalized = value.trim().toLowerCase();
  if (normalized === '') return null;
  if (['si', 'sí', 'true'].includes(normalized)) return true;
  if (['no', 'false'].includes(normalized)) return false;
  throw new Error(`expected.csv, línea ${line}: "parpadea" debe ser si, no o vacío.`);
};

/** Columnas: archivo, testigo, color y parpadea. Las dos últimas son opcionales, y la primera fila puede ser un encabezado. */
export function parseExpectedCsv(content: string): EvalCase[] {
  const cases: EvalCase[] = [];
  content.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    if (raw.trim() === '') return;
    const [archivo = '', esperado = '', color = '', parpadea = ''] = raw.split(',').map((cell) => cell.trim());
    if (index === 0 && archivo.toLowerCase() === 'archivo') return;
    if (!archivo || !esperado) throw new Error(`expected.csv, línea ${line}: faltan el archivo o el testigo esperado.`);
    if (archivo !== path.basename(archivo)) throw new Error(`expected.csv, línea ${line}: "${archivo}" debe ser un nombre de archivo, sin carpetas.`);
    if (esperado !== EXPECT_NONE && !findTelltale(esperado)) throw new Error(`expected.csv, línea ${line}: "${esperado}" no está en el catálogo.`);
    const normalizedColor = color.toLowerCase();
    if (normalizedColor && !(OBSERVED_COLORS as readonly string[]).includes(normalizedColor)) {
      throw new Error(`expected.csv, línea ${line}: el color debe ser uno de ${OBSERVED_COLORS.join(', ')}.`);
    }
    cases.push({ archivo, esperado, color: normalizedColor || null, parpadea: parseBlink(parpadea, line) });
  });
  return cases;
}

/** Sin vehículo: la tabla mide solo si reconoce el testigo, sin pistas de marca o combustible. */
const NO_VEHICLE = { brand: 'desconocida', model: 'desconocida', year: null, fuelType: null };

export async function evaluateCase(identifier: TelltaleIdentifier, testCase: EvalCase, image: Buffer): Promise<EvalRow> {
  const mediaType = detectImageType(image);
  const base = { archivo: testCase.archivo, esperado: testCase.esperado };
  if (!mediaType) return { ...base, obtenido: 'error: no es JPEG, PNG ni WEBP', confianza: null, acierto: false, colorCorrecto: null, parpadeoCorrecto: null };

  const identification = await identifier.identify({ image: { data: image, mediaType }, vehicle: NO_VEHICLE });
  const verdict = evaluateIdentification(identification);
  const obtained = verdict.accepted ? verdict.telltale.id : ASKS_BETTER_INPUT;
  return {
    ...base,
    obtenido: verdict.accepted ? obtained : `${obtained} (modelo: ${identification.telltaleId ?? 'ninguno'})`,
    confianza: identification.confianza,
    acierto: testCase.esperado === EXPECT_NONE ? !verdict.accepted : obtained === testCase.esperado,
    colorCorrecto: testCase.color === null ? null : identification.colorObservado === testCase.color,
    parpadeoCorrecto: testCase.parpadea === null ? null : identification.parpadeando === testCase.parpadea
  };
}

const yesNo = (value: boolean | null) => (value === null ? '-' : value ? 'sí' : 'no');

export function formatReport(rows: EvalRow[]): string {
  const headers = ['archivo', 'esperado', 'obtenido', 'confianza', 'acierto', 'color', 'parpadeo'];
  const table = rows.map((row) => [row.archivo, row.esperado, row.obtenido, row.confianza === null ? '-' : row.confianza.toFixed(2), yesNo(row.acierto), yesNo(row.colorCorrecto), yesNo(row.parpadeoCorrecto)]);
  const widths = headers.map((header, column) => Math.max(header.length, ...table.map((cells) => cells[column]!.length)));
  const toLine = (cells: string[]) => cells.map((cell, column) => cell.padEnd(widths[column]!)).join(' | ').trimEnd();

  const hits = rows.filter((row) => row.acierto).length;
  const percent = rows.length === 0 ? 0 : Math.round((hits / rows.length) * 100);
  return [toLine(headers), widths.map((width) => '-'.repeat(width)).join('-+-'), ...table.map(toLine), '', `Aciertos: ${hits} de ${rows.length} (${percent} %)`].join('\n');
}

export interface RunOptions {
  delayMs: number;
  busyWaitMs?: number;
  wait?: (ms: number) => Promise<unknown>;
  log?: (message: string) => void;
}

/** Espera entre llamadas para respetar el plan gratuito. Si el proveedor está ocupado, espera y reintenta una vez. */
export async function runEvaluation(identifier: TelltaleIdentifier, cases: EvalCase[], readImage: (archivo: string) => Buffer | null, options: RunOptions): Promise<EvalRow[]> {
  const { delayMs, busyWaitMs = BUSY_WAIT_MS, wait = sleep, log = () => {} } = options;
  const rows: EvalRow[] = [];
  const failed = (testCase: EvalCase, reason: string): EvalRow => ({ archivo: testCase.archivo, esperado: testCase.esperado, obtenido: `error: ${reason}`, confianza: null, acierto: false, colorCorrecto: null, parpadeoCorrecto: null });

  let called = false;
  for (const [index, testCase] of cases.entries()) {
    log(`[${index + 1}/${cases.length}] ${testCase.archivo}`);
    const image = readImage(testCase.archivo);
    if (!image) {
      rows.push(failed(testCase, 'el archivo no existe'));
      continue;
    }
    if (called) await wait(delayMs);
    called = true;
    try {
      rows.push(await evaluateCase(identifier, testCase, image));
    } catch (error) {
      if (!(error instanceof TelltaleIdentifierBusyError)) {
        // Solo el tipo de error: nunca el cuerpo de la petición ni cabeceras.
        rows.push(failed(testCase, (error as Error).constructor.name));
        continue;
      }
      log(`  El proveedor está ocupado. Se reintenta en ${Math.round(busyWaitMs / 1000)} s.`);
      await wait(busyWaitMs);
      try {
        rows.push(await evaluateCase(identifier, testCase, image));
      } catch (retryError) {
        rows.push(failed(testCase, retryError instanceof TelltaleIdentifierBusyError ? 'proveedor ocupado' : (retryError as Error).constructor.name));
      }
    }
  }
  return rows;
}

function main(): void {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Falta GEMINI_API_KEY en el .env local.');

  const csvPath = path.join(EVAL_DIR, 'expected.csv');
  if (!existsSync(csvPath)) throw new Error(`No existe ${csvPath}. Crea la carpeta con tus imágenes y ese archivo (ver el README).`);
  const cases = parseExpectedCsv(readFileSync(csvPath, 'utf8'));
  if (cases.length === 0) throw new Error(`${csvPath} no tiene filas.`);

  const delayMs = Number(process.env.EVAL_DELAY_MS ?? DEFAULT_DELAY_MS);
  if (!Number.isFinite(delayMs) || delayMs < 0) throw new Error('EVAL_DELAY_MS debe ser un número de milisegundos.');

  const identifier = new GeminiTelltaleIdentifier({ apiKey, model: process.env.GEMINI_MODEL || DEFAULT_MODEL });
  const readImage = (archivo: string) => {
    const file = path.join(EVAL_DIR, archivo);
    return existsSync(file) ? readFileSync(file) : null;
  };
  console.log(`Evaluando ${cases.length} imágenes, con ${delayMs / 1000} s entre llamadas. Se envían a Gemini: usa solo fotos que puedas compartir.\n`);
  runEvaluation(identifier, cases, readImage, { delayMs, log: console.log })
    .then((rows) => console.log(`\n${formatReport(rows)}`))
    .catch((error: Error) => {
      console.error(error.message);
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
