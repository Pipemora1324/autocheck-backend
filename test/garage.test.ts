import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { EMAIL_NOT_VERIFIED } from '../src/middleware/auth.js';
import { DUPLICATE_PLATE, GARAGE_LIMIT_REACHED, MAX_VEHICLES_PER_USER } from '../src/services/garageService.js';
import { DEFAULT_CLAVE, startTestApp, type TestContext } from './support/testApp.js';

const sandero = {
  plate: 'abc 123',
  brand: 'Renault',
  model: 'Sandero',
  year: 2019,
  color: 'Gris',
  cylinderCc: 1598,
  chassis: '9fbbsraddkm123456',
  fuelType: 'Gasolina',
  serviceType: 'Particular'
};

describe('Garaje /garage', () => {
  let ctx: TestContext;
  let ana: string;
  let luis: string;

  before(async () => {
    ctx = await startTestApp();
    ana = await ctx.registerVerified('ana.garaje@example.com');
    luis = await ctx.registerVerified('luis.garaje@example.com');
  });
  after(() => ctx.close());

  it('exige sesión y correo verificado', async () => {
    assert.equal((await ctx.request('GET', '/garage')).status, 401);
    const unverified = (await ctx.register('sin.verificar.garaje@example.com')).body.accessToken;
    const response = await ctx.request('GET', '/garage', { token: unverified });
    assert.equal(response.status, 403);
    assert.equal(response.body.code, EMAIL_NOT_VERIFIED);
  });

  it('crea un vehículo normalizando placa y chasis', async () => {
    const response = await ctx.request('POST', '/garage', { token: ana, body: sandero });
    assert.equal(response.status, 201);
    assert.equal(response.body.plate, 'ABC-123');
    assert.equal(response.body.kind, 'carro');
    assert.equal(response.body.chassis, '9FBBSRADDKM123456');
    assert.equal(response.body.source, 'manual');
    for (const removed of ['soat', 'rtm', 'soatExpiresOn', 'rtmExpiresOn', 'runtStatus']) assert.equal(response.body[removed], undefined, removed);
    assert.equal(response.body.userId, undefined);
    assert.equal(response.body.id, undefined);
  });

  it('una moto ABC-12D con datos mínimos', async () => {
    const response = await ctx.request('POST', '/garage', { token: ana, body: { plate: 'xyz12d', brand: 'Yamaha', model: 'NMAX' } });
    assert.equal(response.status, 201);
    assert.equal(response.body.plate, 'XYZ-12D');
    assert.equal(response.body.kind, 'moto');
  });

  it('rechaza placas inválidas, datos fuera de rango y campos no permitidos (como el documento del propietario)', async () => {
    const badPlate = await ctx.request('POST', '/garage', { token: ana, body: { ...sandero, plate: 'ABC-1234' } });
    assert.equal(badPlate.status, 400);
    assert.equal(badPlate.body.errors[0].field, 'plate');

    const badData = await ctx.request('POST', '/garage', {
      token: ana,
      body: { ...sandero, plate: 'QWE-111', year: 1800, fuelType: 'Agua' }
    });
    assert.equal(badData.status, 400);
    assert.deepEqual(badData.body.errors.map((error: { field: string }) => error.field).sort(), ['fuelType', 'year']);

    const withOwner = await ctx.request('POST', '/garage', { token: ana, body: { ...sandero, plate: 'QWE-112', ownerDocument: 'CC 123' } });
    assert.equal(withOwner.status, 400);
    assert.deepEqual(withOwner.body.errors, [{ field: 'ownerDocument', message: 'Este campo no está permitido.' }]);

    const runtSource = await ctx.request('POST', '/garage', { token: ana, body: { ...sandero, plate: 'QWE-113', source: 'runt' } });
    assert.equal(runtSource.status, 400);

    const withSoat = await ctx.request('POST', '/garage', { token: ana, body: { ...sandero, plate: 'QWE-114', soatExpiresOn: '2027-06-30' } });
    assert.equal(withSoat.status, 400);
  });

  it('no permite repetir la placa en el mismo garaje', async () => {
    const response = await ctx.request('POST', '/garage', { token: ana, body: { ...sandero, plate: 'ABC-123' } });
    assert.equal(response.status, 409);
    assert.equal(response.body.code, DUPLICATE_PLATE);
  });

  it('lista, consulta (aceptando la placa sin normalizar) y edita', async () => {
    const list = await ctx.request('GET', '/garage', { token: ana });
    assert.deepEqual(list.body.vehicles.map((vehicle: { plate: string }) => vehicle.plate), ['ABC-123', 'XYZ-12D']);

    assert.equal((await ctx.request('GET', '/garage/abc123', { token: ana })).body.model, 'Sandero');

    const patched = await ctx.request('PATCH', '/garage/ABC-123', { token: ana, body: { color: 'Rojo', chassis: null } });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.color, 'Rojo');
    assert.equal(patched.body.chassis, null);

    assert.equal((await ctx.request('PATCH', '/garage/ABC-123', { token: ana, body: {} })).status, 400);
    assert.equal((await ctx.request('PATCH', '/garage/ABC-123', { token: ana, body: { plate: 'ZZZ-999' } })).status, 400);
  });

  it('cada usuario solo ve su garaje: la placa de otro responde 404', async () => {
    assert.deepEqual((await ctx.request('GET', '/garage', { token: luis })).body.vehicles, []);
    for (const [method, path, body] of [
      ['GET', '/garage/ABC-123', undefined],
      ['PATCH', '/garage/ABC-123', { color: 'Negro' }],
      ['DELETE', '/garage/ABC-123', undefined]
    ] as const) {
      assert.equal((await ctx.request(method, path, { token: luis, body })).status, 404, `${method} ${path}`);
    }
    // Luis puede registrar la misma placa en su propio garaje.
    assert.equal((await ctx.request('POST', '/garage', { token: luis, body: sandero })).status, 201);
    assert.equal((await ctx.request('GET', '/garage/ABC-123', { token: ana })).body.color, 'Rojo');
  });

  it('las rutas retiradas ya no existen', async () => {
    assert.equal((await ctx.request('GET', '/garage/ABC-123/assessment', { token: ana })).status, 404);
    assert.equal((await ctx.request('POST', '/garage/ABC-123/refresh-from-runt', { token: ana, body: {} })).status, 404);
  });

  it('elimina un vehículo', async () => {
    assert.equal((await ctx.request('DELETE', '/garage/XYZ-12D', { token: ana })).status, 204);
    assert.equal((await ctx.request('GET', '/garage/XYZ-12D', { token: ana })).status, 404);
    assert.equal((await ctx.request('DELETE', '/garage/XYZ-12D', { token: ana })).status, 404);
  });

  it('limita la cantidad de vehículos por usuario', async () => {
    const token = await ctx.registerVerified('flota@example.com');
    const user = (await ctx.users.findByEmail('flota@example.com'))!;
    for (let index = 0; index < MAX_VEHICLES_PER_USER; index++) {
      await ctx.garage.create(user.id, { ...sandero, plate: `FLT-${String(index).padStart(3, '0')}`, fuelType: 'Gasolina', serviceType: 'Particular', source: 'manual' });
    }
    const response = await ctx.request('POST', '/garage', { token, body: { ...sandero, plate: 'FLT-999' } });
    assert.equal(response.status, 409);
    assert.equal(response.body.code, GARAGE_LIMIT_REACHED);
  });

  it('borrar la cuenta elimina sus vehículos', async () => {
    const user = (await ctx.users.findByEmail('ana.garaje@example.com'))!;
    assert.ok((await ctx.garage.count(user.id)) > 0);
    assert.equal((await ctx.request('DELETE', '/auth/me', { token: ana, body: { password: DEFAULT_CLAVE } })).status, 204);
    assert.equal(await ctx.garage.count(user.id), 0);
  });
});
