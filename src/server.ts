import { createApp } from './app.js';
import { EnvValidationError, loadConfig } from './config/env.js';
import { createPool } from './db/pool.js';
import {
  PgEmailVerificationTokenRepository,
  PgPasswordResetTokenRepository,
  PgRefreshTokenRepository,
  PgUserRepository
} from './repositories/pgAuthRepositories.js';
import { PgDiagnosisRepository } from './repositories/pgDiagnosisRepository.js';
import { PgGarageRepository } from './repositories/pgGarageRepository.js';
import { rateLimitStores } from './middleware/resilientRateLimitStore.js';
import { AuthService } from './services/authService.js';
import { cacheKeys, ResilientCache } from './services/cache.js';
import { SocketHub } from './services/realtime.js';
import { RedisConnection } from './services/redis.js';
import { createCardScanner } from './services/createCardScanner.js';
import { CardScanService } from './services/cardScanService.js';
import { createChatResponder, DiagnosisChatService } from './services/diagnosisChat.js';
import { DiagnosisService } from './services/diagnosisService.js';
import { createTelltaleIdentifier } from './services/geminiTelltaleIdentifier.js';
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
  const redis = config.redisUrl ? new RedisConnection(config.redisUrl) : null;
  if (!redis) console.log('Redis apagado (sin REDIS_URL): caché y límites en memoria.');
  const cache = new ResilientCache(redis);
  const tokenService = new TokenService(config.jwtSecret, config.jwtRefreshSecret);
  const users = new PgUserRepository(pool);
  const realtime = new SocketHub({ tokens: tokenService, users, corsOrigins: config.corsOrigins });
  const authService = new AuthService({
    users,
    resetTokens: new PgPasswordResetTokenRepository(pool),
    verificationTokens: new PgEmailVerificationTokenRepository(pool),
    refreshTokens: new PgRefreshTokenRepository(pool),
    hasher: new Argon2PasswordHasher(),
    tokens: tokenService,
    mailer: createMailer(config),
    appUrl: config.appUrl,
    adminEmails: config.adminEmails,
    onAccountDeleted: async (userId) => {
      realtime.disconnectUser(userId);
      await cache.deleteByPrefix(cacheKeys.userPrefix(userId));
    }
  });
  const garageRepository = new PgGarageRepository(pool);
  const garageService = new GarageService(garageRepository, { cache, realtime });
  const diagnosisRepository = new PgDiagnosisRepository(pool);
  const diagnosisService = new DiagnosisService(
    garageRepository,
    diagnosisRepository,
    createTelltaleIdentifier(config.scan),
    { cache, realtime }
  );
  const diagnosisChatService = new DiagnosisChatService(
    garageRepository,
    diagnosisRepository,
    createChatResponder(config.scan),
    realtime
  );
  if (!diagnosisService.enabled)
    console.warn(
      'Diagnóstico con IA apagado (requiere SCAN_PROVIDER=gemini y GEMINI_API_KEY): solo funciona la elección manual.'
    );
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

  const app = createApp({
    config,
    authService,
    garageService,
    cardScanService,
    diagnosisService,
    diagnosisChatService,
    tokenService,
    users,
    cache,
    redisStatus: () => redis?.status() ?? 'disabled',
    rateLimits: { storeFor: rateLimitStores(redis) }
  });
  const server = app.listen(config.port, () => {
    console.log(`AutoCheck-CO API activa en el puerto ${config.port} (${config.nodeEnv})`);
  });

  realtime.attach(server);
  redis?.onFirstReady(() => {
    redis.pubSubClients().then(
      ({ publisher, subscriber }) => {
        realtime.useRedisAdapter(publisher, subscriber);
      },
      () => {
        console.warn('Socket.IO sigue sin Redis: los eventos solo llegan a esta instancia.');
      }
    );
  });

  const shutdown = (signal: string) => {
    console.log(`${signal} recibido, cerrando servidor...`);
    // realtime.close también cierra el servidor HTTP.
    void Promise.allSettled([realtime.close(), redis?.close(), pool.end()]).finally(() => process.exit(0));
  };
  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
}

start();
