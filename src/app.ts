import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { AppConfig } from './config/env.js';
import { createAuthController } from './controllers/authController.js';
import { cardImageUpload, createCardScanController } from './controllers/cardScanController.js';
import { createConfigController } from './controllers/configController.js';
import { createDiagnosisController, diagnosisUpload } from './controllers/diagnosisController.js';
import { createGarageController } from './controllers/garageController.js';
import { createTelltaleController } from './controllers/telltaleController.js';
import { requireAuth, requireVerifiedEmail } from './middleware/auth.js';
import type { UserRepository } from './repositories/authRepositories.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import {
  createAuthRateLimits,
  createDiagnosisRateLimits,
  perUserHourlyLimiter,
  type RateLimitOptions
} from './middleware/rateLimit.js';
import { requestLogger } from './middleware/requestLogger.js';
import { createAuthRoutes } from './routes/authRoutes.js';
import { createGarageRoutes } from './routes/garageRoutes.js';
import type { AuthService } from './services/authService.js';
import { noCache, type Cache } from './services/cache.js';
import type { RedisStatus } from './services/redis.js';
import type { CardScanService } from './services/cardScanService.js';
import type { DiagnosisChatService } from './services/diagnosisChat.js';
import type { DiagnosisService } from './services/diagnosisService.js';
import type { GarageService } from './services/garageService.js';
import type { TokenService } from './services/tokenService.js';

export interface AppDeps {
  config: Pick<AppConfig, 'isProduction' | 'nodeEnv' | 'corsOrigins' | 'cookie' | 'trustProxy'>;
  authService: AuthService;
  garageService: GarageService;
  cardScanService: CardScanService;
  diagnosisService: DiagnosisService;
  diagnosisChatService: DiagnosisChatService;
  tokenService: TokenService;
  users: UserRepository;
  rateLimits?: RateLimitOptions;
  cache?: Cache;
  /** Estado de Redis para /health. Sin él, se informa como apagado. */
  redisStatus?: () => RedisStatus;
}

export function createApp({
  config,
  authService,
  garageService,
  cardScanService,
  diagnosisService,
  diagnosisChatService,
  tokenService,
  users,
  rateLimits,
  cache = noCache,
  redisStatus = () => 'disabled'
}: AppDeps): Express {
  const app = express();
  const authenticate = requireAuth(tokenService);
  const requireVerified = requireVerifiedEmail(users);

  // Número de proxies de confianza delante de Express, para que req.ip (y el rate limit) sea la IP real:
  // 1 = solo el balanceador de Render; 2 = Vercel (rewrite /api/*) + Render. Ver DEPLOY.md.
  if (config.trustProxy > 0) app.set('trust proxy', config.trustProxy);

  app.use(helmet());
  // Orígenes exactos (validados en env.ts) con credentials. Detrás del rewrite las peticiones del navegador
  // son de mismo origen; CORS sigue protegiendo los accesos directos a la URL de Render.
  app.use(cors({ origin: config.corsOrigins, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  if (config.nodeEnv !== 'test') app.use(requestLogger(config.isProduction));

  app.get('/health', (_request, response) => {
    // Redis es opcional: si falla, la API sigue sana, y solo este campo lo cuenta.
    response.json({ status: 'ok', service: 'AutoCheck-CO', redis: redisStatus() });
  });
  const publicInfo = createConfigController(cardScanService, diagnosisService);
  app.get('/config/public', publicInfo.publicConfig);

  app.use(
    createAuthRoutes(createAuthController(authService, config.cookie), authenticate, createAuthRateLimits(rateLimits))
  );
  app.get('/telltales', authenticate, createTelltaleController(cache).list);
  const cardScan = createCardScanController(cardScanService);
  const scanCardLimit = perUserHourlyLimiter(
    rateLimits?.scanCardPerHour ?? 10,
    'Alcanzaste el máximo de lecturas de tarjeta por hora. Intenta más tarde.',
    { store: rateLimits?.storeFor?.('scan-card') }
  );
  const diagnosis = createDiagnosisController(diagnosisService, diagnosisChatService);
  const diagnosisLimits = createDiagnosisRateLimits(rateLimits ?? {}, diagnosisService.enabled);
  const chatMessagesPerHour = rateLimits?.chatMessagesPerHour ?? 40;
  const chatLimit = perUserHourlyLimiter(
    chatMessagesPerHour,
    `Alcanzaste el máximo de ${chatMessagesPerHour} mensajes por hora en el chat. Intenta más tarde.`,
    { skipClientErrors: true, store: rateLimits?.storeFor?.('chat') }
  );
  app.use(
    createGarageRoutes(createGarageController(garageService), authenticate, requireVerified, {
      // El límite va antes de multer para no procesar subidas que se van a rechazar.
      before: (router) => {
        router.get('/garage/capabilities', publicInfo.capabilities);
        router.post('/garage/scan-card', scanCardLimit, cardImageUpload, cardScan.scan);
      },
      after: (router) => {
        router.post(
          '/garage/:plate/diagnoses',
          diagnosisLimits.uploads,
          diagnosisUpload,
          diagnosisLimits.byKind,
          diagnosis.create
        );
        router.get('/garage/:plate/diagnoses', diagnosis.list);
        router.get('/garage/:plate/diagnoses/:id', diagnosis.get);
        router.delete('/garage/:plate/diagnoses/:id', diagnosis.remove);
        router.get('/garage/:plate/diagnoses/:id/messages', diagnosis.listMessages);
        router.post('/garage/:plate/diagnoses/:id/messages', chatLimit, diagnosis.sendMessage);
      }
    })
  );

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
