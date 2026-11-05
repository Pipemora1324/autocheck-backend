import type { Request, RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';

const WINDOW_MS = 15 * 60 * 1000;

export interface AuthRateLimits {
  register: RequestHandler;
  login: RequestHandler;
  loginByEmail: RequestHandler;
  forgotPassword: RequestHandler;
  forgotPasswordByEmail: RequestHandler;
  resetPassword: RequestHandler;
  verifyEmail: RequestHandler;
  resendVerification: RequestHandler;
  resendVerificationByEmail: RequestHandler;
  deleteAccount: RequestHandler;
}

export interface RateLimitOptions {
  registerMax?: number;
  loginMax?: number;
  loginEmailMax?: number;
  forgotPasswordMax?: number;
  forgotPasswordEmailMax?: number;
  resetPasswordMax?: number;
  verifyEmailMax?: number;
  resendVerificationMax?: number;
  resendVerificationEmailMax?: number;
  deleteAccountMax?: number;
  scanCardPerHour?: number;
}

const limiter = (limit: number, message: string): RequestHandler =>
  rateLimit({
    windowMs: WINDOW_MS,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { message }
  });

const emailFromBody = (request: Request): string => {
  const email: unknown = request.body?.email;
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
};

// Límite por correo, independiente de la IP: frena la fuerza bruta contra una cuenta
// aunque el atacante rote IPs o falsifique X-Forwarded-For.
const emailLimiter = (limit: number, message: string): RequestHandler =>
  rateLimit({
    windowMs: WINDOW_MS,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { message },
    keyGenerator: (request) => `email:${emailFromBody(request)}`,
    skip: (request) => !emailFromBody(request)
  });

export function createAuthRateLimits(options: RateLimitOptions = {}): AuthRateLimits {
  return {
    register: limiter(options.registerMax ?? 10, 'Demasiados registros desde esta conexión. Intenta de nuevo en 15 minutos.'),
    login: limiter(options.loginMax ?? 10, 'Demasiados intentos de inicio de sesión. Intenta de nuevo en 15 minutos.'),
    loginByEmail: emailLimiter(options.loginEmailMax ?? 10, 'Demasiados intentos de inicio de sesión. Intenta de nuevo en 15 minutos.'),
    forgotPassword: limiter(options.forgotPasswordMax ?? 5, 'Demasiadas solicitudes de recuperación. Intenta de nuevo en 15 minutos.'),
    forgotPasswordByEmail: emailLimiter(options.forgotPasswordEmailMax ?? 3, 'Demasiadas solicitudes de recuperación. Intenta de nuevo en 15 minutos.'),
    resetPassword: limiter(options.resetPasswordMax ?? 10, 'Demasiados intentos de restablecimiento. Intenta de nuevo en 15 minutos.'),
    verifyEmail: limiter(options.verifyEmailMax ?? 10, 'Demasiados intentos de verificación. Intenta de nuevo en 15 minutos.'),
    resendVerification: limiter(options.resendVerificationMax ?? 5, 'Demasiadas solicitudes de verificación. Intenta de nuevo en 15 minutos.'),
    resendVerificationByEmail: emailLimiter(options.resendVerificationEmailMax ?? 3, 'Demasiadas solicitudes de verificación. Intenta de nuevo en 15 minutos.'),
    deleteAccount: limiter(options.deleteAccountMax ?? 5, 'Demasiados intentos de eliminar la cuenta. Intenta de nuevo en 15 minutos.')
  };
}

const HOUR_MS = 60 * 60 * 1000;

/** Límite por usuario autenticado (no por IP) para operaciones costosas, como la lectura de tarjetas. */
export function perUserHourlyLimiter(limit: number, message: string): RequestHandler {
  return rateLimit({
    windowMs: HOUR_MS,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { message, code: 'RATE_LIMITED' },
    keyGenerator: (request) => `user:${request.user?.id ?? 'anonimo'}`
  });
}
