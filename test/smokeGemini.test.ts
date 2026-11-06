import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectImageType } from '../src/domain/imageSignature.js';
import { describeProviderError, pickCandidates, syntheticPng } from '../scripts/smokeGemini.js';

describe('smoke:gemini', () => {
  it('deja solo modelos gemini con generateContent y visión, con los lite al final', () => {
    const generate = ['generateContent'];
    const candidates = pickCandidates([
      { name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: generate },
      { name: 'models/gemini-3.5-flash', supportedGenerationMethods: generate },
      { name: 'models/gemini-nano-banana-2.1', supportedGenerationMethods: generate },
      { name: 'models/gemini-3.5-transcribe', supportedGenerationMethods: generate },
      { name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] },
      { name: 'models/otro-modelo', supportedGenerationMethods: generate }
    ]);
    assert.deepEqual(candidates, ['gemini-3.5-flash', 'gemini-3.5-flash-lite']);
  });

  it('resume el error del proveedor sin copiar su mensaje', () => {
    const summary = describeProviderError({
      error: {
        status: 'RESOURCE_EXHAUSTED',
        message: 'texto del proveedor',
        details: [{ violations: [{ quotaId: 'PorDia-FreeTier' }] }, { retryDelay: '30s' }]
      }
    } as Parameters<typeof describeProviderError>[0]);
    assert.equal(summary, 'RESOURCE_EXHAUSTED PorDia-FreeTier reintentar en 30s');
    assert.equal(describeProviderError({}), '-');
  });

  it('genera una imagen sintética que el servidor reconoce como PNG', () => {
    assert.equal(detectImageType(syntheticPng()), 'image/png');
  });
});
