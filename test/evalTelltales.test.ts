import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluateImage, formatReport, runEvaluation } from '../scripts/evalTelltales.js';
import { TelltaleIdentifierBusyError, TelltaleIdentifierUnavailableError, type DashboardReading, type ModelTelltale, type TelltaleIdentifier } from '../src/services/telltaleIdentifier.js';
import { modelTelltale, reading } from './support/fakeGemini.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const asReading = (testigos: Array<Record<string, unknown>>, overrides: Record<string, unknown> = {}) => reading(testigos, overrides) as unknown as DashboardReading;

const fakeIdentifier = (...answers: Array<DashboardReading | Error>): TelltaleIdentifier & { calls: number } => ({
  provider: 'gemini',
  calls: 0,
  async identify() {
    const answer = answers[this.calls++]!;
    if (answer instanceof Error) throw answer;
    return answer;
  }
});

describe('eval:telltales', () => {
  it('evalúa lo que vería el usuario: los testigos pasan por el piso de seguridad', async () => {
    const row = await evaluateImage(fakeIdentifier(asReading([modelTelltale({ nombre: 'Aceite', categoria: 'aceite', urgencia: 'informativo' }) as ModelTelltale])), 'a.jpg', JPEG);
    assert.equal(row.resultado, 'ok');
    assert.equal(row.general, 'rojo');
    assert.equal(row.testigos[0]!.urgencia, 'rojo');
  });

  it('distingue una foto sin testigos de una que pide mejor foto, y una que no es imagen no llama a la IA', async () => {
    assert.equal((await evaluateImage(fakeIdentifier(asReading([])), 'a.jpg', JPEG)).resultado, 'sin testigos');
    assert.equal((await evaluateImage(fakeIdentifier(asReading([], { necesitaMejorFoto: true })), 'a.jpg', JPEG)).resultado, 'pide mejor foto');
    const identifier = fakeIdentifier();
    assert.match((await evaluateImage(identifier, 'a.txt', Buffer.from('texto'))).resultado, /no es JPEG/);
    assert.equal(identifier.calls, 0);
  });

  it('espera entre llamadas, y no antes de la primera', async () => {
    const waits: number[] = [];
    const identifier = fakeIdentifier(asReading([]), asReading([]), asReading([]));
    const rows = await runEvaluation(identifier, ['a.jpg', 'b.jpg', 'c.jpg'], () => JPEG, { delayMs: 500, wait: async (ms) => waits.push(ms) });
    assert.equal(rows.length, 3);
    assert.deepEqual(waits, [500, 500]);
  });

  it('si el proveedor está ocupado espera y reintenta una vez; otros errores no detienen la corrida ni exponen el detalle', async () => {
    const waits: number[] = [];
    const options = { delayMs: 1, busyWaitMs: 99, wait: async (ms: number) => waits.push(ms) };
    const retried = await runEvaluation(fakeIdentifier(new TelltaleIdentifierBusyError('429'), asReading([modelTelltale()])), ['a.jpg'], () => JPEG, options);
    assert.equal(retried[0]!.resultado, 'ok');
    assert.deepEqual(waits, [99]);

    const busy = await runEvaluation(fakeIdentifier(new TelltaleIdentifierBusyError('429'), new TelltaleIdentifierBusyError('429')), ['a.jpg'], () => JPEG, options);
    assert.match(busy[0]!.resultado, /proveedor ocupado/);

    const providerDetail = 'detalle-privado-del-proveedor';
    const down = await runEvaluation(fakeIdentifier(new TelltaleIdentifierUnavailableError(providerDetail), asReading([modelTelltale()])), ['a.jpg', 'b.jpg'], () => JPEG, options);
    assert.equal(down.length, 2);
    assert.ok(!down[0]!.resultado.includes(providerDetail));
    assert.equal(down[1]!.resultado, 'ok');
  });

  it('el reporte muestra cada testigo y el total', () => {
    const report = formatReport([
      { archivo: 'a.jpg', resultado: 'ok', general: 'rojo', mejorFoto: false, testigos: [{ nombre: 'Aceite', urgencia: 'rojo', categoria: 'aceite', color: 'rojo', confianza: 0.931 }] },
      { archivo: 'b.jpg', resultado: 'error: X', general: null, mejorFoto: false, testigos: [] }
    ]);
    assert.match(report, /a\.jpg: ok, urgencia general rojo, 1 testigos/);
    assert.match(report, /Aceite \| rojo \| aceite \| color rojo \| confianza 0\.93/);
    assert.match(report, /Con testigos: 1 de 2\. Con error: 1\./);
  });
});
