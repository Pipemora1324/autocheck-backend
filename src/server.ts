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
import { AuthService } from './services/authService.js';
import { createCardScanner } from './services/createCardScanner.js';
import { CardScanService } from './services/cardScanService.js';
import { GarageService } from './services/garageService.js';
import { createMailer } from './services/mailer.js';
import { Argon2PasswordHasher } from './services/passwordHasher.js';
import { TokenService } from './services/tokenService.js';

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
  const garageService = new GarageService(new PgGarageRepository(pool));
  const cardScanService = new CardScanService(createCardScanner(config.scan));
  if (config.scan.provider === 'none') {
    console.warn(
      config.scan.missingKeyFor
        ? `SCAN_PROVIDER=${config.scan.missingKeyFor} sin su clave: POST /garage/scan-card responderá 503.`
        : 'SCAN_PROVIDER=none: POST /garage/scan-card responderá 503.'
    );
  } else {
    console.log(`Lectura de tarjeta: ${config.scan.provider} (${config.scan.model}).`);
  }

  const app = createApp({ config, authService, garageService, cardScanService, tokenService, users });
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
