import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluateCase, formatReport, parseExpectedCsv, runEvaluation, type EvalCase } from '../scripts/evalTelltales.js';
import { TelltaleIdentifierBusyError, TelltaleIdentifierUnavailableError, type TelltaleIdentification, type TelltaleIdentifier } from '../src/services/telltaleIdentifier.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

const identification = (telltaleId: string | null, overrides: Partial<TelltaleIdentification> = {}): TelltaleIdentification => ({
  telltaleId,
  nombreDetectado: null,
  confianza: 0.9,
  colorObservado: 'desconocido',
  parpadeando: null,
  telltaleAlternativo: null,
  notaEspecificaDelVehiculo: null,
  pideMejorEntrada: false,
  ...overrides
});

const fakeIdentifier = (...answers: Array<TelltaleIdentification | Error>): TelltaleIdentifier & { calls: number } => ({
  provider: 'gemini',
  calls: 0,
  async identify() {
    const answer = answers[this.calls++]!;
    if (answer instanceof Error) throw answer;
    return answer;
  }
});

const testCase = (overrides: Partial<EvalCase> = {}): EvalCase => ({ archivo: 'a.jpg', esperado: 'abs', color: null, parpadea: null, ...overrides });

describe('eval:telltales', () => {
  it('lee expected.csv con encabezado opcional y columnas opcionales', () => {
    const csv = 'archivo,testigo,color,parpadea\r\na.jpg,abs,amarillo,no\nb.png,check_engine,,si\n\nc.webp,tpms\nd.jpg,ninguno\n';
    assert.deepEqual(parseExpectedCsv(csv), [
      { archivo: 'a.jpg', esperado: 'abs', color: 'amarillo', parpadea: false },
      { archivo: 'b.png', esperado: 'check_engine', color: null, parpadea: true },
      { archivo: 'c.webp', esperado: 'tpms', color: null, parpadea: null },
      { archivo: 'd.jpg', esperado: 'ninguno', color: null, parpadea: null }
    ]);
    assert.equal(parseExpectedCsv('a.jpg,abs').length, 1);
  });

  it('rechaza filas inválidas indicando la línea', () => {
    assert.throws(() => parseExpectedCsv('a.jpg,no_existe'), /línea 1.*no está en el catálogo/);
    assert.throws(() => parseExpectedCsv('a.jpg,abs,morado'), /línea 1.*color/);
    assert.throws(() => parseExpectedCsv('a.jpg,abs,rojo,tal vez'), /línea 1.*parpadea/);
    assert.throws(() => parseExpectedCsv('archivo,testigo\nb.jpg'), /línea 2.*faltan/);
    assert.throws(() => parseExpectedCsv('../.env,abs'), /sin carpetas/);
  });

  it('un acierto exige que el testigo sobreviva a la validación del servidor', async () => {
    const hit = await evaluateCase(fakeIdentifier(identification('abs', { colorObservado: 'amarillo' })), testCase({ color: 'amarillo' }), JPEG);
    assert.equal(hit.acierto, true);
    assert.equal(hit.obtenido, 'abs');
    assert.equal(hit.colorCorrecto, true);

    const rejected = await evaluateCase(fakeIdentifier(identification('abs', { colorObservado: 'rojo' })), testCase({ color: 'amarillo' }), JPEG);
    assert.equal(rejected.acierto, false);
    assert.match(rejected.obtenido, /pide mejor entrada \(modelo: abs\)/);
    assert.equal(rejected.colorCorrecto, false);

    const wrong = await evaluateCase(fakeIdentifier(identification('tpms')), testCase(), JPEG);
    assert.equal(wrong.acierto, false);
    assert.equal(wrong.colorCorrecto, null);
  });

  it('con esperado "ninguno", el acierto es pedir mejor entrada', async () => {
    assert.equal((await evaluateCase(fakeIdentifier(identification(null)), testCase({ esperado: 'ninguno' }), JPEG)).acierto, true);
    assert.equal((await evaluateCase(fakeIdentifier(identification('abs')), testCase({ esperado: 'ninguno' }), JPEG)).acierto, false);
  });

  it('compara el parpadeo solo si expected.csv lo indica', async () => {
    const row = await evaluateCase(fakeIdentifier(identification('check_engine', { parpadeando: null })), testCase({ esperado: 'check_engine', parpadea: true }), JPEG);
    assert.equal(row.parpadeoCorrecto, false);
    assert.equal(row.acierto, true);
  });

  it('espera entre llamadas, y no antes de la primera', async () => {
    const waits: number[] = [];
    const identifier = fakeIdentifier(identification('abs'), identification('abs'), identification('abs'));
    const cases = [testCase(), testCase({ archivo: 'b.jpg' }), testCase({ archivo: 'c.jpg' })];
    const rows = await runEvaluation(identifier, cases, () => JPEG, { delayMs: 500, wait: async (ms) => waits.push(ms) });
    assert.equal(rows.length, 3);
    assert.deepEqual(waits, [500, 500]);
  });

  it('un archivo faltante o que no es imagen se reporta sin llamar a la IA', async () => {
    const identifier = fakeIdentifier();
    const rows = await runEvaluation(identifier, [testCase(), testCase({ archivo: 'b.txt' })], (archivo) => (archivo === 'a.jpg' ? null : Buffer.from('texto')), { delayMs: 0, wait: async () => {} });
    assert.match(rows[0]!.obtenido, /no existe/);
    assert.match(rows[1]!.obtenido, /no es JPEG/);
    assert.equal(identifier.calls, 0);
  });

  it('si el proveedor está ocupado espera y reintenta una vez; otros errores no detienen la corrida ni exponen el detalle', async () => {
    const waits: number[] = [];
    const options = { delayMs: 1, busyWaitMs: 99, wait: async (ms: number) => waits.push(ms) };
    const retried = await runEvaluation(fakeIdentifier(new TelltaleIdentifierBusyError('429'), identification('abs')), [testCase()], () => JPEG, options);
    assert.equal(retried[0]!.acierto, true);
    assert.deepEqual(waits, [99]);

    const busy = await runEvaluation(fakeIdentifier(new TelltaleIdentifierBusyError('429'), new TelltaleIdentifierBusyError('429')), [testCase()], () => JPEG, options);
    assert.match(busy[0]!.obtenido, /proveedor ocupado/);

    const providerDetail = 'detalle-privado-del-proveedor';
    const down = await runEvaluation(fakeIdentifier(new TelltaleIdentifierUnavailableError(providerDetail), identification('abs')), [testCase(), testCase({ archivo: 'b.jpg' })], () => JPEG, options);
    assert.equal(down.length, 2);
    assert.ok(!down[0]!.obtenido.includes(providerDetail));
    assert.equal(down[1]!.acierto, true);
  });

  it('la tabla muestra cada columna y el total de aciertos', () => {
    const report = formatReport([
      { archivo: 'a.jpg', esperado: 'abs', obtenido: 'abs', confianza: 0.931, acierto: true, colorCorrecto: true, parpadeoCorrecto: null },
      { archivo: 'b.jpg', esperado: 'tpms', obtenido: 'error: el archivo no existe', confianza: null, acierto: false, colorCorrecto: null, parpadeoCorrecto: null }
    ]);
    for (const header of ['archivo', 'esperado', 'obtenido', 'confianza', 'acierto']) assert.match(report, new RegExp(header));
    assert.match(report, /a\.jpg\s+\| abs\s+\| abs\s+\| 0\.93\s+\| sí/);
    assert.match(report, /Aciertos: 1 de 2 \(50 %\)/);
    assert.match(formatReport([]), /Aciertos: 0 de 0/);
  });
});
