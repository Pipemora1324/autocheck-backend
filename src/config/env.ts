import { z } from 'zod';

const optionalString = z.preprocess((value) => (value === '' ? undefined : value), z.string().trim().optional());

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    CORS_ORIGIN: optionalString,
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: 'Es obligatoria y debe ser una URL postgres:// válida' }),
    JWT_SECRET: z.string({ error: 'Es obligatoria' }).min(32, 'Debe tener al menos 32 caracteres'),
    JWT_REFRESH_SECRET: z.string({ error: 'Es obligatoria' }).min(32, 'Debe tener al menos 32 caracteres'),
    APP_URL: z.preprocess((value) => (value === '' ? undefined : value), z.url().optional()),
    SMTP_HOST: optionalString,
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_USER: optionalString,
    SMTP_PASS: optionalString,
    MAIL_FROM: optionalString,
    COOKIE_PATH: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().regex(/^\/[\w\-/]*$/, 'Debe ser una ruta que empiece por /, por ejemplo /api/auth').default('/auth')
    ),
    COOKIE_SAMESITE: z.preprocess(
      (value) => (value === '' || value === undefined ? undefined : String(value).toLowerCase()),
      z.enum(['strict', 'lax', 'none'], { error: 'Debe ser strict, lax o none' }).optional()
    ),
    // Cantidad de proxies delante de Express (ver DEPLOY.md, "Proxies y rate limit").
    TRUST_PROXY: z.preprocess((value) => (value === '' ? undefined : value), z.coerce.number().int().min(0).max(5).optional()),
    // Lectura de la tarjeta de propiedad con visión. Sin clave, POST /garage/scan-card responde 503.
    ANTHROPIC_API_KEY: optionalString,
    ANTHROPIC_MODEL: z.preprocess((value) => (value === '' ? undefined : value), z.string().trim().min(1).default('claude-opus-5-5')),
    // Consulta RUNT por proveedor externo. none (por defecto) = solo garaje manual.
    RUNT_PROVIDER: z.preprocess(
      (value) => (value === '' || value === undefined ? undefined : String(value).toLowerCase()),
      z.enum(['none', 'verifik'], { error: 'Debe ser none o verifik' }).default('none')
    ),
    VERIFIK_API_KEY: optionalString
  })
  .superRefine((env, context) => {
    if (env.JWT_SECRET === env.JWT_REFRESH_SECRET) {
      context.addIssue({ code: 'custom', path: ['JWT_REFRESH_SECRET'], message: 'Debe ser distinto de JWT_SECRET' });
    }
    if (env.NODE_ENV === 'production') {
      if (!env.CORS_ORIGIN) context.addIssue({ code: 'custom', path: ['CORS_ORIGIN'], message: 'Es obligatorio en producción' });
      if (!env.APP_URL) context.addIssue({ code: 'custom', path: ['APP_URL'], message: 'Es obligatorio en producción' });
    }
    // Con credentials, CORS exige orígenes exactos: '*' no está permitido.
    for (const origin of (env.CORS_ORIGIN ?? '').split(',').map((item) => item.trim()).filter(Boolean)) {
      if (!/^https?:\/\/[^/\s*]+$/.test(origin)) {
        context.addIssue({ code: 'custom', path: ['CORS_ORIGIN'], message: `Origen inválido "${origin}": usa https://dominio sin / final ni comodines` });
      }
    }
    if (env.RUNT_PROVIDER === 'verifik' && !env.VERIFIK_API_KEY) {
      context.addIssue({ code: 'custom', path: ['VERIFIK_API_KEY'], message: 'Es obligatoria cuando RUNT_PROVIDER=verifik' });
    }
    // SameSite=None solo es aceptado por los navegadores junto con Secure, que solo se activa en producción.
    if (env.COOKIE_SAMESITE === 'none' && env.NODE_ENV !== 'production') {
      context.addIssue({ code: 'custom', path: ['COOKIE_SAMESITE'], message: 'none requiere cookies Secure (solo en producción)' });
    }
    const smtpFields = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'] as const;
    const configured = smtpFields.filter((field) => env[field]);
    if (configured.length > 0 && configured.length < smtpFields.length) {
      for (const field of smtpFields.filter((name) => !env[name])) {
        context.addIssue({ code: 'custom', path: [field], message: 'Falta para completar la configuración SMTP' });
      }
    }
  });

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

export interface CookieConfig {
  path: string;
  sameSite: 'strict' | 'lax' | 'none';
  secure: boolean;
}

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  isProduction: boolean;
  port: number;
  corsOrigins: string[];
  cookie: CookieConfig;
  trustProxy: number;
  anthropic: { apiKey: string; model: string } | null;
  runtProvider: { name: 'none' } | { name: 'verifik'; apiKey: string };
  databaseUrl: string;
  jwtSecret: string;
  jwtRefreshSecret: string;
  appUrl: string;
  smtp: SmtpConfig | null;
}

export class EnvValidationError extends Error {}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `  - ${issue.path.join('.') || 'env'}: ${issue.message}`).join('\n');
    throw new EnvValidationError(`Configuración inválida. Revisa las variables de entorno (ver .env.example):\n${details}`);
  }

  const env = parsed.data;
  const devOrigin = 'http://localhost:4200';
  const isProduction = env.NODE_ENV === 'production';
  return {
    nodeEnv: env.NODE_ENV,
    isProduction,
    port: env.PORT,
    corsOrigins: (env.CORS_ORIGIN ?? devOrigin).split(',').map((origin) => origin.trim()).filter(Boolean),
    cookie: {
      path: env.COOKIE_PATH,
      sameSite: env.COOKIE_SAMESITE ?? (isProduction ? 'strict' : 'lax'),
      secure: isProduction
    },
    trustProxy: env.TRUST_PROXY ?? (isProduction ? 1 : 0),
    anthropic: env.ANTHROPIC_API_KEY ? { apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL } : null,
    runtProvider: env.RUNT_PROVIDER === 'verifik' && env.VERIFIK_API_KEY ? { name: 'verifik', apiKey: env.VERIFIK_API_KEY } : { name: 'none' },
    databaseUrl: env.DATABASE_URL,
    jwtSecret: env.JWT_SECRET,
    jwtRefreshSecret: env.JWT_REFRESH_SECRET,
    appUrl: (env.APP_URL ?? devOrigin).replace(/\/+$/, ''),
    smtp: env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS && env.MAIL_FROM
      ? { host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER, pass: env.SMTP_PASS, from: env.MAIL_FROM }
      : null
  };
}
