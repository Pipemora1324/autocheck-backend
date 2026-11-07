import type { Request, RequestHandler } from 'express';
import { rateLimit, type Store } from 'express-rate-limit';

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
  /** Diagnósticos que llaman a la IA. */
  aiDiagnosesPerHour?: number;
  /** Diagnósticos con el testigo elegido de la lista. */
  manualDiagnosesPerHour?: number;
  /** Mensajes al chat con IA, por usuario. */
  chatMessagesPerHour?: number;
  /** Un almacén por límite. Sin él, cada límite cuenta en la memoria del proceso. */
  storeFor?: (name: string) => Store;
}

const limiter = (limit: number, message: string, store?: Store): RequestHandler =>
  rateLimit({
    ...(store ? { store } : {}),
    windowMs: WINDOW_MS,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { message }
  });

const emailFromBody = (request: Request): string => {
  const { email } = (request.body ?? {}) as { email?: unknown };
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
};

// Límite por correo, independiente de la IP: frena la fuerza bruta contra una cuenta
// aunque el atacante rote IPs o falsifique X-Forwarded-For.
const emailLimiter = (limit: number, message: string, store?: Store): RequestHandler =>
  rateLimit({
    ...(store ? { store } : {}),
    windowMs: WINDOW_MS,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { message },
    keyGenerator: (request) => `email:${emailFromBody(request)}`,
    skip: (request) => !emailFromBody(request)
  });

export function createAuthRateLimits(options: RateLimitOptions = {}): AuthRateLimits {
  const { storeFor } = options;
  const byIp = (name: string, limit: number, message: string) => limiter(limit, message, storeFor?.(name));
  const byEmail = (name: string, limit: number, message: string) => emailLimiter(limit, message, storeFor?.(name));
  const LOGIN = 'Demasiados intentos de inicio de sesión. Intenta de nuevo en 15 minutos.';
  const FORGOT = 'Demasiadas solicitudes de recuperación. Intenta de nuevo en 15 minutos.';
  const RESEND = 'Demasiadas solicitudes de verificación. Intenta de nuevo en 15 minutos.';
  return {
    register: byIp(
      'register',
      options.registerMax ?? 10,
      'Demasiados registros desde esta conexión. Intenta de nuevo en 15 minutos.'
    ),
    login: byIp('login', options.loginMax ?? 10, LOGIN),
    loginByEmail: byEmail('login-email', options.loginEmailMax ?? 10, LOGIN),
    forgotPassword: byIp('forgot', options.forgotPasswordMax ?? 5, FORGOT),
    forgotPasswordByEmail: byEmail('forgot-email', options.forgotPasswordEmailMax ?? 3, FORGOT),
    resetPassword: byIp(
      'reset',
      options.resetPasswordMax ?? 10,
      'Demasiados intentos de restablecimiento. Intenta de nuevo en 15 minutos.'
    ),
    verifyEmail: byIp(
      'verify',
      options.verifyEmailMax ?? 10,
      'Demasiados intentos de verificación. Intenta de nuevo en 15 minutos.'
    ),
    resendVerification: byIp('resend', options.resendVerificationMax ?? 5, RESEND),
    resendVerificationByEmail: byEmail('resend-email', options.resendVerificationEmailMax ?? 3, RESEND),
    deleteAccount: byIp(
      'delete-account',
      options.deleteAccountMax ?? 5,
      'Demasiados intentos de eliminar la cuenta. Intenta de nuevo en 15 minutos.'
    )
  };
}

const HOUR_MS = 60 * 60 * 1000;

type DiagnosisLimitScope = 'ia' | 'manual' | 'total';

interface PerUserLimiterOptions {
  /** Campos adicionales del cuerpo del 429. */
  details?: Record<string, unknown>;
  /** Los errores 4xx no llegaron a la operación costosa: no cuentan. */
  skipClientErrors?: boolean;
  skip?: () => boolean;
  store?: Store;
}

/** Límite por usuario autenticado (no por IP) para operaciones costosas, como la lectura de tarjetas. */
export function perUserHourlyLimiter(
  limit: number,
  message: string,
  { details, skipClientErrors = false, skip, store }: PerUserLimiterOptions = {}
): RequestHandler {
  return rateLimit({
    ...(store ? { store } : {}),
    windowMs: HOUR_MS,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { message, code: 'RATE_LIMITED', ...details },
    keyGenerator: (request) => `user:${request.user?.id ?? 'anonimo'}`,
    ...(skip ? { skip } : {}),
    ...(skipClientErrors
      ? {
          skipFailedRequests: true,
          requestWasSuccessful: (_request: Request, response: { statusCode: number }) =>
            response.statusCode < 400 || response.statusCode >= 500
        }
      : {})
  });
}

const isManualChoice = (request: Request): boolean => {
  const { telltaleId } = (request.body ?? {}) as { telltaleId?: unknown };
  return typeof telltaleId === 'string' && telltaleId.trim() !== '';
};

export interface DiagnosisRateLimits {
  /** Va antes de multer: acota las subidas de un usuario, aunque se rechacen después. */
  uploads: RequestHandler;
  /** Va después de multer, porque necesita ver si llegó telltaleId. */
  byKind: RequestHandler;
}

/**
 * La IA y la elección manual tienen contadores separados: la manual no gasta el cupo de la IA, y sigue disponible cuando este se agota.
 * Sin IA configurada no se consume nada del cupo de la IA, porque no hay llamada.
 */
export function createDiagnosisRateLimits(options: RateLimitOptions, aiEnabled: boolean): DiagnosisRateLimits {
  const aiMax = options.aiDiagnosesPerHour ?? 15;
  const manualMax = options.manualDiagnosesPerHour ?? 60;
  const ai = perUserHourlyLimiter(
    aiMax,
    `Alcanzaste el máximo de ${aiMax} diagnósticos con IA por hora. Intenta más tarde o elige el testigo de la lista, que no cuenta para este límite.`,
    {
      details: { limite: 'ia' satisfies DiagnosisLimitScope },
      skipClientErrors: true,
      skip: () => !aiEnabled,
      store: options.storeFor?.('diagnosis-ia')
    }
  );
  const manual = perUserHourlyLimiter(
    manualMax,
    `Alcanzaste el máximo de ${manualMax} consultas de la lista por hora. Intenta más tarde.`,
    {
      details: { limite: 'manual' satisfies DiagnosisLimitScope },
      skipClientErrors: true,
      store: options.storeFor?.('diagnosis-manual')
    }
  );
  return {
    uploads: perUserHourlyLimiter(
      aiMax + manualMax,
      'Alcanzaste el máximo de solicitudes de diagnóstico por hora. Intenta más tarde.',
      {
        details: { limite: 'total' satisfies DiagnosisLimitScope },
        store: options.storeFor?.('diagnosis-total')
      }
    ),
    byKind: (request, response, next) => (isManualChoice(request) ? manual : ai)(request, response, next)
  };
}
