import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applySafetyFloor,
  NEVER_DRIVE_ACTION,
  PARKING_BRAKE_ACTION,
  SAFE_STOP_MECHANIC,
  SAFETY_SYSTEM_ACTION,
  suggestsDriving,
  worstUrgency
} from '../src/domain/diagnosisSafety.js';
import type { ModelTelltale } from '../src/services/telltaleIdentifier.js';
import { modelTelltale } from './support/fakeGemini.js';

const telltale = (overrides: Record<string, unknown> = {}) => modelTelltale(overrides) as ModelTelltale;

describe('Piso de seguridad', () => {
  it('aceite, temperatura, frenos y dirección: siempre rojo y detenerse, aunque el modelo diga lo contrario', () => {
    for (const categoria of ['aceite', 'temperatura', 'frenos', 'direccion']) {
      const final = applySafetyFloor(
        telltale({
          categoria,
          urgencia: 'informativo',
          color: 'desconocido',
          confianza: 0.1,
          puedesRevisar: ['Puedes seguir manejando hasta tu casa.', 'Mira si hay manchas debajo del vehículo.'],
          noHagas: ['Sigue manejando despacio.', 'No sigas manejando.'],
          cuandoIrAlMecanico: 'Cuando puedas, la próxima semana.',
          notaDelVehiculo: 'En este modelo puedes seguir manejando sin problema.'
        })
      );
      assert.equal(final.urgencia, 'rojo', categoria);
      assert.equal(final.debeDetenerse, true, categoria);
      assert.equal(final.accion, NEVER_DRIVE_ACTION, categoria);
      assert.equal(final.cuandoIrAlMecanico, SAFE_STOP_MECHANIC, categoria);
      assert.deepEqual(final.puedesRevisar, ['Mira si hay manchas debajo del vehículo.'], categoria);
      assert.deepEqual(final.noHagas, ['No sigas manejando.'], categoria);
      assert.equal(final.notaDelVehiculo, null, categoria);
    }
  });

  it('batería: como mínimo rojo y detenerse, igual que en el catálogo', () => {
    const final = applySafetyFloor(telltale({ categoria: 'bateria_carga', urgencia: 'amarillo' }));
    assert.equal(final.urgencia, 'rojo');
    assert.equal(final.debeDetenerse, true);
  });

  it('airbag: como mínimo rojo, sin ordenar detenerse', () => {
    const final = applySafetyFloor(telltale({ categoria: 'airbag', urgencia: 'informativo' }));
    assert.equal(final.urgencia, 'rojo');
    assert.equal(final.debeDetenerse, false);
    assert.equal(final.accion, SAFETY_SYSTEM_ACTION);
  });

  it('freno de mano: no sube a rojo por el color, y siempre avisa qué hacer si sigue encendido', () => {
    const final = applySafetyFloor(
      telltale({ nombre: 'Freno de mano', categoria: 'freno_mano', urgencia: 'rojo', color: 'rojo' })
    );
    assert.equal(final.urgencia, 'amarillo');
    assert.equal(final.debeDetenerse, false);
    assert.equal(final.accion, PARKING_BRAKE_ACTION);
    assert.equal(
      applySafetyFloor(
        telltale({ nombre: 'Testigo de freno de mano', categoria: 'freno_mano', urgencia: 'informativo' })
      ).urgencia,
      'informativo'
    );
  });

  it('freno de mano con el freno liberado, según el usuario: se trata como frenos', () => {
    for (const description of [
      'ya solté el freno de mano y sigue prendido',
      'el freno de mano está abajo pero no se apaga',
      'con el freno liberado sigue encendido'
    ]) {
      const final = applySafetyFloor(
        telltale({ nombre: 'Freno de mano', categoria: 'freno_mano', urgencia: 'informativo' }),
        { description }
      );
      assert.equal(final.categoria, 'frenos', description);
      assert.equal(final.urgencia, 'rojo', description);
      assert.equal(final.debeDetenerse, true, description);
    }
    assert.equal(
      applySafetyFloor(telltale({ nombre: 'Freno de mano', categoria: 'freno_mano', urgencia: 'informativo' }), {
        description: 'se prendió al parquear'
      }).categoria,
      'freno_mano'
    );
  });

  it('un freno de mano dudoso se trata como frenos: nombres que devolvió Gemini con fotos reales', () => {
    for (const nombre of [
      'Freno de mano o nivel de líquido de frenos',
      'Testigo de frenos',
      'Sistema de frenos / Freno de mano'
    ]) {
      const final = applySafetyFloor(
        telltale({ nombre, categoria: 'freno_mano', urgencia: 'amarillo', color: 'rojo' })
      );
      assert.equal(final.categoria, 'frenos', nombre);
      assert.equal(final.urgencia, 'rojo', nombre);
      assert.equal(final.debeDetenerse, true, nombre);
      assert.equal(final.accion, NEVER_DRIVE_ACTION, nombre);
    }
  });

  it('check engine: sube a rojo si parpadea, lo diga el usuario o el modelo; fijo sigue en amarillo', () => {
    assert.equal(applySafetyFloor(telltale(), { blinking: true }).urgencia, 'rojo');
    assert.equal(applySafetyFloor(telltale(), { blinking: true }).debeDetenerse, true);
    assert.equal(applySafetyFloor(telltale({ parpadeando: true })).debeDetenerse, true);
    assert.equal(applySafetyFloor(telltale({ parpadeando: false })).urgencia, 'amarillo');
    assert.equal(applySafetyFloor(telltale()).debeDetenerse, false);
    assert.equal(applySafetyFloor(telltale({ categoria: 'llantas' }), { blinking: true }).urgencia, 'amarillo');
  });

  it('transmisión en rojo conserva la orden de detenerse del catálogo', () => {
    assert.equal(applySafetyFloor(telltale({ categoria: 'transmision', urgencia: 'rojo' })).debeDetenerse, true);
    assert.equal(
      applySafetyFloor(telltale({ categoria: 'transmision', urgencia: 'amarillo', color: 'rojo' })).debeDetenerse,
      true
    );
    assert.equal(
      applySafetyFloor(telltale({ categoria: 'transmision', urgencia: 'amarillo', color: 'amarillo' })).debeDetenerse,
      false
    );
  });

  it('un símbolo sin identificar en rojo se trata como rojo; el color no cambia los demás', () => {
    assert.equal(
      applySafetyFloor(telltale({ categoria: 'otro', urgencia: 'informativo', color: 'rojo' })).urgencia,
      'rojo'
    );
    assert.equal(
      applySafetyFloor(telltale({ categoria: 'informativo', urgencia: 'informativo', color: 'rojo' })).urgencia,
      'informativo'
    );
  });

  it('la urgencia general es la más grave', () => {
    assert.equal(worstUrgency(['informativo', 'rojo', 'amarillo']), 'rojo');
    assert.equal(worstUrgency(['informativo', 'amarillo']), 'amarillo');
    assert.equal(worstUrgency([]), 'informativo');
  });

  it('suggestsDriving distingue una sugerencia de una prohibición', () => {
    for (const text of [
      'Puedes seguir manejando hasta tu casa.',
      'Es seguro continuar hasta el taller.',
      'Sigue conduciendo despacio.',
      'Maneja con cuidado hasta el taller.',
      'Llévalo despacio al taller.',
      'No es grave.',
      'Puedes llegar a casa sin problema.'
    ]) {
      assert.equal(suggestsDriving(text), true, text);
    }
    for (const text of [
      'No sigas manejando.',
      'No puedes seguir manejando.',
      'Evita seguir conduciendo.',
      'Nunca continúes manejando con este testigo.',
      'Detente en un lugar seguro.',
      'Mira si hay manchas debajo.'
    ]) {
      assert.equal(suggestsDriving(text), false, text);
    }
  });
});
