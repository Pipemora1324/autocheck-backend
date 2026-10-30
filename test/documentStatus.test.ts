import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { documentStatus, todayInColombia } from '../src/services/documentStatus.js';

const at = (iso: string) => new Date(iso);

describe('documentStatus', () => {
  it('es Vigente con más de 30 días por delante', () => {
    const result = documentStatus('SOAT-1', '2026-12-01', at('2026-10-30T12:00:00Z'));
    assert.equal(result.status, 'Vigente');
    assert.equal(result.alert, 'verde');
  });

  it('es Por Vencer con 30 días o menos, incluido el día del vencimiento', () => {
    assert.equal(documentStatus('SOAT-1', '2026-11-29', at('2026-10-30T12:00:00Z')).status, 'Por Vencer');
    assert.equal(documentStatus('SOAT-1', '2026-11-30', at('2026-10-30T12:00:00Z')).status, 'Vigente');
    const today = documentStatus('SOAT-1', '2026-10-30', at('2026-10-30T12:00:00Z'));
    assert.equal(today.status, 'Por Vencer');
    assert.equal(today.daysToExpire, 0);
  });

  it('es Vencido desde el día siguiente al vencimiento', () => {
    const result = documentStatus('SOAT-1', '2026-10-29', at('2026-10-30T12:00:00Z'));
    assert.equal(result.status, 'Vencido');
    assert.equal(result.daysToExpire, -1);
    assert.equal(result.alert, 'rojo');
  });

  it('usa la fecha de Colombia, no la UTC', () => {
    // 03:00 UTC del 31 es aún 30 de octubre en Bogotá (UTC-5).
    assert.equal(todayInColombia(at('2026-10-31T03:00:00Z')), '2026-10-30');
    assert.equal(documentStatus('RTM-1', '2026-10-30', at('2026-10-31T03:00:00Z')).status, 'Por Vencer');
  });
});
