import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';

const WINDOW_MS = 15 * 60 * 1000;

export interface AuthRateLimits {
  register: RequestHandler;
  login: RequestHandler;
  forgotPassword: RequestHandler;
  resetPassword: RequestHandler;
}

export interface RateLimitOptions {
  registerMax?: number;
  loginMax?: number;
  forgotPasswordMax?: number;
  resetPasswordMax?: number;
}

const limiter = (limit: number, message: string): RequestHandler =>
  rateLimit({
    windowMs: WINDOW_MS,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { message }
  });

export function createAuthRateLimits(options: RateLimitOptions = {}): AuthRateLimits {
  return {
    register: limiter(options.registerMax ?? 10, 'Demasiados registros desde esta conexión. Intenta de nuevo en 15 minutos.'),
    login: limiter(options.loginMax ?? 10, 'Demasiados intentos de inicio de sesión. Intenta de nuevo en 15 minutos.'),
    forgotPassword: limiter(options.forgotPasswordMax ?? 5, 'Demasiadas solicitudes de recuperación. Intenta de nuevo en 15 minutos.'),
    resetPassword: limiter(options.resetPasswordMax ?? 10, 'Demasiados intentos de restablecimiento. Intenta de nuevo en 15 minutos.')
  };
}
