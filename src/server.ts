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
import { GarageService } from './services/garageService.js';
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

  if (config.isProduction && !config.smtp) {
    console.warn('SMTP no configurado: no se enviarán correos de verificación ni de recuperación hasta definir SMTP_*.');
  }

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
    appUrl: config.appUrl
  });
  const vehicleService = new VehicleService(new PgVehicleRepository(pool));
  const garageService = new GarageService(new PgGarageRepository(pool));

  const app = createApp({ config, authService, vehicleService, garageService, tokenService, users });
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
