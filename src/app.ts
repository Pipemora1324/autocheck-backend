import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import type { AppConfig } from './config/env.js';
import { createAuthController } from './controllers/authController.js';
import { createVehicleController } from './controllers/vehicleController.js';
import { requireAuth } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { createAuthRateLimits, type RateLimitOptions } from './middleware/rateLimit.js';
import { createAuthRoutes } from './routes/authRoutes.js';
import { createVehicleRoutes } from './routes/vehicleRoutes.js';
import type { AuthService } from './services/authService.js';
import type { TokenService } from './services/tokenService.js';
import type { VehicleService } from './services/vehicleService.js';

export interface AppDeps {
  config: Pick<AppConfig, 'isProduction' | 'nodeEnv' | 'corsOrigins'>;
  authService: AuthService;
  vehicleService: VehicleService;
  tokenService: TokenService;
  rateLimits?: RateLimitOptions;
}

export function createApp({ config, authService, vehicleService, tokenService, rateLimits }: AppDeps): Express {
  const app = express();
  const authenticate = requireAuth(tokenService);

  // Render coloca un proxy delante: necesario para que el rate limit use la IP real del cliente.
  if (config.isProduction) app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  if (config.nodeEnv !== 'test') app.use(morgan(config.isProduction ? 'combined' : 'dev'));

  app.get('/health', (_request, response) => {
    response.json({ status: 'ok', service: 'AutoCheck-CO' });
  });

  app.use(createAuthRoutes(createAuthController(authService, { secureCookies: config.isProduction }), authenticate, createAuthRateLimits(rateLimits)));
  app.use(createVehicleRoutes(createVehicleController(vehicleService), authenticate));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
