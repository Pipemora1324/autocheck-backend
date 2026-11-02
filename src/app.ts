import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import type { AppConfig } from './config/env.js';
import { createAuthController } from './controllers/authController.js';
import { cardImageUpload, createCardScanController } from './controllers/cardScanController.js';
import { createGarageController } from './controllers/garageController.js';
import { createRuntController } from './controllers/runtController.js';
import { createVehicleController } from './controllers/vehicleController.js';
import { requireAuth, requireVerifiedEmail } from './middleware/auth.js';
import type { UserRepository } from './repositories/authRepositories.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { createAuthRateLimits, perUserHourlyLimiter, type RateLimitOptions } from './middleware/rateLimit.js';
import { createAuthRoutes } from './routes/authRoutes.js';
import { createGarageRoutes } from './routes/garageRoutes.js';
import { createVehicleRoutes } from './routes/vehicleRoutes.js';
import type { AuthService } from './services/authService.js';
import type { CardScanService } from './services/cardScanService.js';
import type { GarageService } from './services/garageService.js';
import type { RuntLookupService } from './services/runtLookupService.js';
import type { TokenService } from './services/tokenService.js';
import type { VehicleService } from './services/vehicleService.js';

export interface AppDeps {
  config: Pick<AppConfig, 'isProduction' | 'nodeEnv' | 'corsOrigins' | 'cookie' | 'trustProxy'>;
  authService: AuthService;
  vehicleService: VehicleService;
  garageService: GarageService;
  cardScanService: CardScanService;
  runtLookupService: RuntLookupService;
  tokenService: TokenService;
  users: UserRepository;
  rateLimits?: RateLimitOptions;
}

export function createApp({ config, authService, vehicleService, garageService, cardScanService, runtLookupService, tokenService, users, rateLimits }: AppDeps): Express {
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
  if (config.nodeEnv !== 'test') app.use(morgan(config.isProduction ? 'combined' : 'dev'));

  app.get('/health', (_request, response) => {
    response.json({ status: 'ok', service: 'AutoCheck-CO' });
  });

  app.use(createAuthRoutes(createAuthController(authService, config.cookie), authenticate, createAuthRateLimits(rateLimits)));
  app.use(createVehicleRoutes(createVehicleController(vehicleService), authenticate, requireVerified));
  const cardScan = createCardScanController(cardScanService);
  const runt = createRuntController(runtLookupService, cardScanService);
  const runtLimit = perUserHourlyLimiter(rateLimits?.runtLookupPerHour ?? 5, 'Alcanzaste el máximo de consultas al RUNT por hora. Intenta más tarde.');
  const scanCardLimit = perUserHourlyLimiter(rateLimits?.scanCardPerHour ?? 10, 'Alcanzaste el máximo de lecturas de tarjeta por hora. Intenta más tarde.');
  app.use(
    createGarageRoutes(createGarageController(garageService), authenticate, requireVerified, {
      // El límite va antes de multer para no procesar subidas que se van a rechazar.
      before: (router) => {
        router.get('/garage/capabilities', runt.capabilities);
        router.post('/garage/scan-card', scanCardLimit, cardImageUpload, cardScan.scan);
      },
      after: (router) => router.post('/garage/:plate/refresh-from-runt', runtLimit, runt.refresh)
    })
  );

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
