import { z } from 'zod';

const optionalString = z.preprocess((value) => (value === '' ? undefined : value), z.string().trim().optional());
const isEmail = (value: string) => z.email().safeParse(value).success;

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    CORS_ORIGIN: optionalString,
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: 'Es obligatoria y debe ser una URL postgres:// válida' }),
    JWT_SECRET: z.string({ error: 'Es obligatoria' }).min(32, 'Debe tener al menos 32 caracteres'),
    JWT_REFRESH_SECRET: z.string({ error: 'Es obligatoria' }).min(32, 'Debe tener al menos 32 caracteres'),
    APP_URL: z.preprocess((value) => (value === '' ? undefined : value), z.url().optional()),
    // Correo: brevo (API HTTPS; Render gratuito bloquea los puertos SMTP), smtp o console (solo desarrollo).
    EMAIL_PROVIDER: z.preprocess(
      (value) => (value === '' || value === undefined ? undefined : String(value).toLowerCase()),
      z.enum(['brevo', 'smtp', 'console'], { error: 'Debe ser brevo, smtp o console' }).optional()
    ),
    BREVO_API_KEY: optionalString,
    MAIL_FROM: optionalString,
    MAIL_FROM_NAME: z.preprocess((value) => (value === '' ? undefined : value), z.string().trim().min(1).max(70).default('AutoCheck-CO')),
    SMTP_HOST: optionalString,
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_USER: optionalString,
    SMTP_PASS: optionalString,
    // Correos que reciben rol admin al verificar su correo o iniciar sesión ya verificados.
    ADMIN_EMAILS: optionalString,
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
    // Lectura de la tarjeta de propiedad con visión: gemini (plan gratuito), anthropic o none.
    // Sin proveedor o sin su clave, POST /garage/scan-card responde 503.
    SCAN_PROVIDER: z.preprocess(
      (value) => (value === '' || value === undefined ? undefined : String(value).toLowerCase()),
      z.enum(['gemini', 'anthropic', 'none'], { error: 'Debe ser gemini, anthropic o none' }).default('none')
    ),
    GEMINI_API_KEY: optionalString,
    GEMINI_MODEL: z.preprocess((value) => (value === '' ? undefined : value), z.string().trim().min(1).default('gemini-3.5-flash-lite')),
    ANTHROPIC_API_KEY: optionalString,
    ANTHROPIC_MODEL: z.preprocess((value) => (value === '' ? undefined : value), z.string().trim().min(1).default('claude-sonnet-5-5')),
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
    const provider = emailProvider(env);
    if (provider === 'brevo' && !env.BREVO_API_KEY) {
      context.addIssue({ code: 'custom', path: ['BREVO_API_KEY'], message: 'Es obligatoria con EMAIL_PROVIDER=brevo (en producción es el proveedor por defecto)' });
    }
    if (provider === 'smtp') {
      for (const field of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'] as const) {
        if (!env[field]) context.addIssue({ code: 'custom', path: [field], message: 'Es obligatoria con EMAIL_PROVIDER=smtp' });
      }
    }
    if (provider !== 'console' && !env.MAIL_FROM) {
      context.addIssue({ code: 'custom', path: ['MAIL_FROM'], message: `Es obligatoria con EMAIL_PROVIDER=${provider}: el correo remitente verificado` });
    }
    if (env.MAIL_FROM && !isEmail(env.MAIL_FROM)) {
      context.addIssue({ code: 'custom', path: ['MAIL_FROM'], message: 'Debe ser solo el correo (por ejemplo no-reply@dominio.com); el nombre va en MAIL_FROM_NAME' });
    }
    if (provider === 'console' && env.NODE_ENV === 'production') {
      context.addIssue({ code: 'custom', path: ['EMAIL_PROVIDER'], message: 'console no envía correos: en producción usa brevo o smtp' });
    }
    for (const email of splitList(env.ADMIN_EMAILS)) {
      if (!isEmail(email)) context.addIssue({ code: 'custom', path: ['ADMIN_EMAILS'], message: `Correo inválido "${email}"` });
    }
  });

const splitList = (value: string | undefined) => (value ?? '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);

// En producción el proveedor por defecto es brevo; en desarrollo y pruebas, la consola.
function emailProvider(env: { EMAIL_PROVIDER?: 'brevo' | 'smtp' | 'console' | undefined; NODE_ENV: string }) {
  return env.EMAIL_PROVIDER ?? (env.NODE_ENV === 'production' ? 'brevo' : 'console');
}

export interface MailFrom {
  email: string;
  name: string;
}

export type ScanConfig =
  | { provider: 'gemini' | 'anthropic'; apiKey: string; model: string }
  /** missingKeyFor: el proveedor pedido en SCAN_PROVIDER cuya clave falta (para avisar al arrancar). */
  | { provider: 'none'; missingKeyFor?: 'gemini' | 'anthropic' };

export type EmailConfig =
  | { provider: 'brevo'; apiKey: string; from: MailFrom }
  | { provider: 'smtp'; host: string; port: number; user: string; pass: string; from: MailFrom }
  | { provider: 'console' };

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
  scan: ScanConfig;
  runtProvider: { name: 'none' } | { name: 'verifik'; apiKey: string };
  databaseUrl: string;
  jwtSecret: string;
  jwtRefreshSecret: string;
  appUrl: string;
  email: EmailConfig;
  adminEmails: string[];
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
    scan: toScanConfig(env),
    runtProvider: env.RUNT_PROVIDER === 'verifik' && env.VERIFIK_API_KEY ? { name: 'verifik', apiKey: env.VERIFIK_API_KEY } : { name: 'none' },
    databaseUrl: env.DATABASE_URL,
    jwtSecret: env.JWT_SECRET,
    jwtRefreshSecret: env.JWT_REFRESH_SECRET,
    appUrl: (env.APP_URL ?? devOrigin).replace(/\/+$/, ''),
    email: toEmailConfig(env),
    adminEmails: splitList(env.ADMIN_EMAILS)
  };
}

function toScanConfig(env: z.infer<typeof envSchema>): ScanConfig {
  if (env.SCAN_PROVIDER === 'gemini') {
    return env.GEMINI_API_KEY ? { provider: 'gemini', apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL } : { provider: 'none', missingKeyFor: 'gemini' };
  }
  if (env.SCAN_PROVIDER === 'anthropic') {
    return env.ANTHROPIC_API_KEY
      ? { provider: 'anthropic', apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL }
      : { provider: 'none', missingKeyFor: 'anthropic' };
  }
  return { provider: 'none' };
}

function toEmailConfig(env: z.infer<typeof envSchema>): EmailConfig {
  const provider = emailProvider(env);
  const from = { email: env.MAIL_FROM!, name: env.MAIL_FROM_NAME };
  if (provider === 'brevo') return { provider, apiKey: env.BREVO_API_KEY!, from };
  if (provider === 'smtp') return { provider, host: env.SMTP_HOST!, port: env.SMTP_PORT, user: env.SMTP_USER!, pass: env.SMTP_PASS!, from };
  return { provider: 'console' };
}
