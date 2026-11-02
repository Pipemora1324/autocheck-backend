import { createApp } from './app.js';
import { EnvValidationError, loadConfig } from './config/env.js';
import { createPool } from './db/pool.js';
import {
  PgEmailVerificationTokenRepository,
  PgPasswordResetTokenRepository,
  PgRefreshTokenRepository,
  PgUserRepository
} from './repositories/pgAuthRepositories.js';
import { PgGarageRepository } from './repositories/pgGarageRepository.js';
import { PgVehicleRepository } from './repositories/pgVehicleRepository.js';
import { AuthService } from './services/authService.js';
import { createVehicleLookupProvider } from './providers/createVehicleLookupProvider.js';
import { createCardReader } from './services/cardReader.js';
import { CardScanService } from './services/cardScanService.js';
import { GarageService } from './services/garageService.js';
import { RuntLookupService } from './services/runtLookupService.js';
import { createMailer } from './services/mailer.js';
import { Argon2PasswordHasher } from './services/passwordHasher.js';
import { TokenService } from './services/tokenService.js';
import { VehicleService } from './services/vehicleService.js';

function start(): void {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof EnvValidationError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  console.log(`Correo: proveedor ${config.email.provider}.`);

  const pool = createPool(config.databaseUrl);
  const tokenService = new TokenService(config.jwtSecret, config.jwtRefreshSecret);
  const users = new PgUserRepository(pool);
  const authService = new AuthService({
    users,
    resetTokens: new PgPasswordResetTokenRepository(pool),
    verificationTokens: new PgEmailVerificationTokenRepository(pool),
    refreshTokens: new PgRefreshTokenRepository(pool),
    hasher: new Argon2PasswordHasher(),
    tokens: tokenService,
    mailer: createMailer(config),
    appUrl: config.appUrl,
    adminEmails: config.adminEmails
  });
  const vehicleService = new VehicleService(new PgVehicleRepository(pool));
  const garageRepository = new PgGarageRepository(pool);
  const garageService = new GarageService(garageRepository);
  const runtLookupService = new RuntLookupService(createVehicleLookupProvider(config.runtProvider), garageRepository, garageService);
  if (config.runtProvider.name === 'verifik') {
    console.warn('RUNT_PROVIDER=verifik: el adaptador es un esqueleto (ver src/providers/verifikProvider.ts) y responderá 501.');
  }
  const cardScanService = new CardScanService(createCardReader(config.anthropic));
  if (!cardScanService.enabled) console.warn('ANTHROPIC_API_KEY no configurada: POST /garage/scan-card responderá 503.');

  const app = createApp({ config, authService, vehicleService, garageService, cardScanService, runtLookupService, tokenService, users });
  const server = app.listen(config.port, () => {
    console.log(`AutoCheck-CO API activa en el puerto ${config.port} (${config.nodeEnv})`);
  });

  const shutdown = (signal: string) => {
    console.log(`${signal} recibido, cerrando servidor...`);
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start();
