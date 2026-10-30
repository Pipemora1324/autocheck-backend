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
    MAIL_FROM: optionalString
  })
  .superRefine((env, context) => {
    if (env.JWT_SECRET === env.JWT_REFRESH_SECRET) {
      context.addIssue({ code: 'custom', path: ['JWT_REFRESH_SECRET'], message: 'Debe ser distinto de JWT_SECRET' });
    }
    if (env.NODE_ENV === 'production') {
      if (!env.CORS_ORIGIN) context.addIssue({ code: 'custom', path: ['CORS_ORIGIN'], message: 'Es obligatorio en producción' });
      if (!env.APP_URL) context.addIssue({ code: 'custom', path: ['APP_URL'], message: 'Es obligatorio en producción' });
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

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  isProduction: boolean;
  port: number;
  corsOrigins: string[];
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
  return {
    nodeEnv: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    port: env.PORT,
    corsOrigins: (env.CORS_ORIGIN ?? devOrigin).split(',').map((origin) => origin.trim()).filter(Boolean),
    databaseUrl: env.DATABASE_URL,
    jwtSecret: env.JWT_SECRET,
    jwtRefreshSecret: env.JWT_REFRESH_SECRET,
    appUrl: (env.APP_URL ?? devOrigin).replace(/\/+$/, ''),
    smtp: env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS && env.MAIL_FROM
      ? { host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER, pass: env.SMTP_PASS, from: env.MAIL_FROM }
      : null
  };
}
