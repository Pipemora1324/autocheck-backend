import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { findTelltale, TELLTALES } from '../src/data/telltales.js';
import { EMAIL_NOT_VERIFIED } from '../src/middleware/auth.js';
import { startTestApp, type TestContext } from './support/testApp.js';

describe('Catálogo de testigos', () => {
  it('tiene entre 35 y 45 testigos con id estable y único', () => {
    assert.ok(TELLTALES.length >= 35 && TELLTALES.length <= 45, `tiene ${TELLTALES.length}`);
    assert.equal(new Set(TELLTALES.map((item) => item.id)).size, TELLTALES.length);
    for (const { id } of TELLTALES) assert.match(id, /^[a-z][a-z0-9_]+$/);
  });

  it('incluye todos los testigos mínimos', () => {
    const required = [
      'check_engine',
      'presion_aceite',
      'temperatura_motor',
      'bateria_alternador',
      'sistema_frenos',
      'freno_mano',
      'pastillas_freno',
      'abs',
      'airbag',
      'cinturon',
      'tpms',
      'direccion_asistida',
      'control_estabilidad',
      'combustible_bajo',
      'nivel_refrigerante',
      'limpiabrisas_bajo',
      'tapa_tanque',
      'puerta_capo_baul',
      'filtro_particulas',
      'bujias_precalentamiento',
      'mantenimiento',
      'luces_altas',
      'antiniebla_delanteras',
      'antiniebla_traseras',
      'direccionales',
      'inmovilizador_llave',
      'transmision',
      'sistema_hibrido_electrico',
      'crucero',
      'epc',
      'asistente_carril'
    ];
    for (const id of required) assert.ok(findTelltale(id), id);
  });

  it('aceite, temperatura, frenos y dirección siempre son rojo con neverDrive', () => {
    for (const id of ['presion_aceite', 'temperatura_motor', 'sistema_frenos', 'direccion_asistida']) {
      const telltale = findTelltale(id)!;
      assert.equal(telltale.severidad, 'rojo', id);
      assert.equal(telltale.neverDrive, true, id);
    }
  });

  it('neverDrive implica rojo, y ningún texto de esos testigos invita a seguir manejando', () => {
    for (const telltale of TELLTALES.filter((item) => item.neverDrive)) {
      assert.equal(telltale.severidad, 'rojo', telltale.id);
      const texts = [telltale.significado, telltale.cuandoIrAlMecanico, ...telltale.puedesRevisar].join(' ');
      assert.doesNotMatch(
        texts,
        /puedes? (seguir|continuar)|sigue manejando|llega(r)? al taller manejando/i,
        telltale.id
      );
      assert.match(telltale.noHagas.join(' '), /No sigas manejando|no sigas manejando/, telltale.id);
    }
  });

  it('airbag es rojo sin neverDrive: el vehículo puede moverse, pero no se debe depender de esa protección', () => {
    const airbag = findTelltale('airbag')!;
    assert.equal(airbag.severidad, 'rojo');
    assert.equal(airbag.neverDrive, false);
    const texts = [airbag.cuandoIrAlMecanico, ...airbag.puedesRevisar, ...airbag.noHagas].join(' ');
    assert.doesNotMatch(texts, /no sigas manejando|antes de volver a manejar/i);
    assert.match(airbag.cuandoIrAlMecanico, /puede moverse/);
    assert.match(airbag.cuandoIrAlMecanico, /hoy mismo/i);
    assert.match(airbag.cuandoIrAlMecanico, /escáner/);
    assert.match(airbag.noHagas.join(' '), /conectores amarillos/);
    assert.match(airbag.noHagas.join(' '), /No dependas de esa protección/);
    assert.match(airbag.noHagas.join(' '), /pretensores/);
  });

  it('transmisión no pide dejar la palanca en neutro', () => {
    const text = findTelltale('transmision')!.puedesRevisar.join(' ');
    assert.match(text, /en P \(o con el freno de mano si es manual\)/);
    assert.doesNotMatch(text, /neutro/);
  });

  it('incluye los alias colombianos y los testigos nuevos', () => {
    assert.ok(findTelltale('presion_aceite')!.alias.includes('lámpara de Aladino'));
    assert.ok(findTelltale('check_engine')!.alias.includes('motorcito'));
    assert.equal(findTelltale('epc')!.severidad, 'amarillo');
    assert.deepEqual(findTelltale('epc')!.aplicaA, ['gasolina', 'diesel']);
    assert.equal(findTelltale('asistente_carril')!.severidad, 'informativo');
  });

  it('solo check engine cambia al parpadear', () => {
    assert.deepEqual(
      TELLTALES.filter((item) => item.siParpadea).map((item) => item.id),
      ['check_engine']
    );
    assert.equal(findTelltale('check_engine')!.severidad, 'amarillo');
    assert.match(findTelltale('check_engine')!.siParpadea!.cuandoIrAlMecanico, /si se ignora/i);
  });

  it('cada testigo tiene todo su contenido', () => {
    for (const item of TELLTALES) {
      for (const field of ['nombre', 'descripcionSimbolo', 'significado', 'cuandoIrAlMecanico'] as const)
        assert.ok(item[field].length > 10 || field === 'nombre', `${item.id}.${field}`);
      for (const field of ['alias', 'causasProbables', 'puedesRevisar', 'noHagas', 'aplicaA'] as const)
        assert.ok(item[field].length > 0, `${item.id}.${field}`);
      // El motivo concreto: dice qué puede pasar si se ignora, no un genérico "ve al taller".
      assert.match(item.cuandoIrAlMecanico, /si se ignora/i, item.id);
    }
  });

  it('los testigos informativos aclaran que no son una falla', () => {
    for (const item of TELLTALES.filter((telltale) => telltale.severidad === 'informativo')) {
      assert.match(item.significado, /no indica|no es/i, item.id);
    }
  });

  it('no inventa cifras: no hay presiones, temperaturas, distancias ni tiempos concretos', () => {
    const allText = JSON.stringify(TELLTALES);
    assert.doesNotMatch(allText, /\d/);
  });

  it('los testigos de un solo tipo de motor quedan limitados a ese tipo', () => {
    for (const id of ['filtro_particulas', 'bujias_precalentamiento', 'adblue', 'agua_filtro_diesel'])
      assert.deepEqual(findTelltale(id)!.aplicaA, ['diesel'], id);
    assert.ok(!findTelltale('presion_aceite')!.aplicaA.includes('electrico'));
    assert.deepEqual(findTelltale('sistema_hibrido_electrico')!.aplicaA, ['hibrido', 'electrico']);
  });

  it('el archivo avisa que debe revisarlo una persona con conocimiento mecánico', () => {
    const source = readFileSync(new URL('../src/data/telltales.ts', import.meta.url), 'utf8');
    assert.match(source, /revisado por una persona con conocimiento mecánico/);
  });
});

describe('GET /telltales', () => {
  let ctx: TestContext;
  before(async () => {
    ctx = await startTestApp();
  });
  after(() => ctx.close());

  it('exige sesión', async () => {
    assert.equal((await ctx.request('GET', '/telltales')).status, 401);
  });

  it('devuelve el catálogo resumido, sin el contenido del diagnóstico', async () => {
    const token = await ctx.registerVerified('catalogo@example.com');
    const response = await ctx.request('GET', '/telltales', { token });
    assert.equal(response.status, 200);
    assert.equal(response.body.telltales.length, TELLTALES.length);
    const item = response.body.telltales.find((telltale: { id: string }) => telltale.id === 'presion_aceite');
    assert.deepEqual(Object.keys(item).sort(), ['alias', 'debeDetenerse', 'id', 'nombre', 'severidad']);
    assert.equal(item.severidad, 'rojo');
    assert.equal(item.debeDetenerse, true);
    const airbag = response.body.telltales.find((telltale: { id: string }) => telltale.id === 'airbag');
    assert.equal(airbag.severidad, 'rojo');
    assert.equal(airbag.debeDetenerse, false);
  });

  it('solo pide sesión: no exige correo verificado', async () => {
    const unverified = (await ctx.register('catalogo.sinverificar@example.com')).body.accessToken;
    const response = await ctx.request('GET', '/telltales', { token: unverified });
    assert.equal(response.status, 200);
    assert.notEqual(response.body.code, EMAIL_NOT_VERIFIED);
  });
});
