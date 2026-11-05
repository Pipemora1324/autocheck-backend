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
import { createAuthRateLimits, perUserHourlyLimiter, type RateLimitOptions } from './middleware/rateLimit.js';
import { requestLogger } from './middleware/requestLogger.js';
import { createAuthRoutes } from './routes/authRoutes.js';
import { createGarageRoutes } from './routes/garageRoutes.js';
import type { AuthService } from './services/authService.js';
import type { CardScanService } from './services/cardScanService.js';
import type { DiagnosisService } from './services/diagnosisService.js';
import type { GarageService } from './services/garageService.js';
import type { TokenService } from './services/tokenService.js';

export interface AppDeps {
  config: Pick<AppConfig, 'isProduction' | 'nodeEnv' | 'corsOrigins' | 'cookie' | 'trustProxy'>;
  authService: AuthService;
  garageService: GarageService;
  cardScanService: CardScanService;
  diagnosisService: DiagnosisService;
  tokenService: TokenService;
  users: UserRepository;
  rateLimits?: RateLimitOptions;
}

export function createApp({ config, authService, garageService, cardScanService, diagnosisService, tokenService, users, rateLimits }: AppDeps): Express {
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
    response.json({ status: 'ok', service: 'AutoCheck-CO' });
  });
  const publicInfo = createConfigController(cardScanService, diagnosisService);
  app.get('/config/public', publicInfo.publicConfig);

  app.use(createAuthRoutes(createAuthController(authService, config.cookie), authenticate, createAuthRateLimits(rateLimits)));
  app.get('/telltales', authenticate, createTelltaleController().list);
  const cardScan = createCardScanController(cardScanService);
  const scanCardLimit = perUserHourlyLimiter(rateLimits?.scanCardPerHour ?? 10, 'Alcanzaste el máximo de lecturas de tarjeta por hora. Intenta más tarde.');
  const diagnosis = createDiagnosisController(diagnosisService);
  const diagnosisLimit = perUserHourlyLimiter(rateLimits?.diagnosesPerHour ?? 15, 'Alcanzaste el máximo de 15 diagnósticos por hora. Intenta más tarde.');
  app.use(
    createGarageRoutes(createGarageController(garageService), authenticate, requireVerified, {
      // El límite va antes de multer para no procesar subidas que se van a rechazar.
      before: (router) => {
        router.get('/garage/capabilities', publicInfo.capabilities);
        router.post('/garage/scan-card', scanCardLimit, cardImageUpload, cardScan.scan);
      },
      after: (router) => {
        router.post('/garage/:plate/diagnoses', diagnosisLimit, diagnosisUpload, diagnosis.create);
        router.get('/garage/:plate/diagnoses', diagnosis.list);
        router.get('/garage/:plate/diagnoses/:id', diagnosis.get);
        router.delete('/garage/:plate/diagnoses/:id', diagnosis.remove);
      }
    })
  );

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
