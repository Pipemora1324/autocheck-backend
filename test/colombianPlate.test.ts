import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizePlate, plateKind } from '../src/domain/colombianPlate.js';
import { colombianPlateSchema } from '../src/validation/garageSchemas.js';

describe('Placas colombianas', () => {
  it('normaliza carros ABC-123 y motos ABC-12D', () => {
    for (const [input, expected] of [
      ['ABC-123', 'ABC-123'],
      ['abc123', 'ABC-123'],
      [' abc 123 ', 'ABC-123'],
      ['XYZ-12D', 'XYZ-12D'],
      ['xyz12d', 'XYZ-12D'],
      ['Xyz 12d', 'XYZ-12D']
    ]) {
      assert.equal(normalizePlate(input), expected, input);
    }
  });

  it('rechaza formatos que no son colombianos', () => {
    for (const input of ['ABC-1234', 'AB-123', 'ABCD-123', 'ABC-1D2', 'ABC-12', '123-ABC', 'ABC--123', 'ÁBC-123', '']) {
      assert.equal(normalizePlate(input), null, input);
    }
  });

  it('distingue carro y moto', () => {
    assert.equal(plateKind('ABC-123'), 'carro');
    assert.equal(plateKind('ABC-12D'), 'moto');
  });

  it('el esquema zod normaliza y explica el formato esperado', () => {
    assert.equal(colombianPlateSchema.parse('def456'), 'DEF-456');
    const result = colombianPlateSchema.safeParse('ABC-1234');
    assert.equal(result.success, false);
    assert.match(result.error.issues[0].message, /ABC-123 \(carro\) o ABC-12D \(moto\)/);
  });
});
