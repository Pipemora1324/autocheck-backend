import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp, type AppDeps } from '../../src/app.js';
import type { RateLimitOptions } from '../../src/middleware/rateLimit.js';
import { AuthService } from '../../src/services/authService.js';
import type { CardScanner } from '../../src/services/cardScanner.js';
import { CardScanService } from '../../src/services/cardScanService.js';
import { GarageService } from '../../src/services/garageService.js';
import type { Mailer } from '../../src/services/mailer.js';
import { Argon2PasswordHasher } from '../../src/services/passwordHasher.js';
import { TokenService } from '../../src/services/tokenService.js';
import {
  MemoryGarageRepository,
  MemoryOneTimeTokenRepository,
  MemoryRefreshTokenRepository,
  MemoryUserRepository
} from './memoryRepositories.js';

// Se generan en cada corrida para no dejar valores con forma de secreto en el repositorio.
export const TEST_ACCESS_SECRET = randomBytes(32).toString('hex');
export const TEST_REFRESH_SECRET = randomBytes(32).toString('hex');
export const DEFAULT_CLAVE = 'contraseña-segura';

const tokenFrom = (url: string | undefined) => {
  if (!url) throw new Error('No se envió ningún correo');
  return new URL(url).searchParams.get('token')!;
};

export class CapturingMailer implements Mailer {
  readonly sent: Array<{ to: string; resetUrl: string }> = [];
  readonly verifications: Array<{ to: string; verifyUrl: string }> = [];

  async sendPasswordReset(to: string, resetUrl: string) {
    this.sent.push({ to, resetUrl });
  }

  async sendEmailVerification(to: string, verifyUrl: string) {
    this.verifications.push({ to, verifyUrl });
  }

  lastToken(): string {
    return tokenFrom(this.sent.at(-1)?.resetUrl);
  }

  lastVerificationToken(to?: string): string {
    const matching = to ? this.verifications.filter((item) => item.to === to) : this.verifications;
    return tokenFrom(matching.at(-1)?.verifyUrl);
  }
}

export interface TestResponse {
  status: number;
  body: any;
  headers: Headers;
  cookie: string | undefined;
}

export interface RequestOptions {
  body?: unknown;
  rawBody?: string;
  token?: string;
  cookie?: string;
  headers?: Record<string, string>;
}

export const NO_RATE_LIMITS: RateLimitOptions = {
  registerMax: 1000,
  loginMax: 1000,
  loginEmailMax: 1000,
  forgotPasswordMax: 1000,
  forgotPasswordEmailMax: 1000,
  resetPasswordMax: 1000,
  verifyEmailMax: 1000,
  resendVerificationMax: 1000,
  resendVerificationEmailMax: 1000,
  deleteAccountMax: 1000,
  scanCardPerHour: 1000
};

export interface TestAppOptions {
  rateLimits?: RateLimitOptions;
  config?: Partial<AppDeps['config']>;
  /** null simula un servidor sin ANTHROPIC_API_KEY. */
  cardReader?: CardScanner | null;
  /** Reemplaza el CapturingMailer (por ejemplo, el mailer real con un fetch simulado). */
  mailer?: Mailer;
  adminEmails?: string[];
}

export interface TestContext {
  users: MemoryUserRepository;
  resetTokens: MemoryOneTimeTokenRepository;
  verificationTokens: MemoryOneTimeTokenRepository;
  refreshTokens: MemoryRefreshTokenRepository;
  garage: MemoryGarageRepository;
  mailer: CapturingMailer;
  tokens: TokenService;
  clock: { now: Date };
  request(method: string, path: string, options?: RequestOptions): Promise<TestResponse>;
  register(email: string, clave?: string): Promise<TestResponse>;
  /** Registra, confirma el correo con el enlace enviado y devuelve el access token. */
  registerVerified(email: string, clave?: string): Promise<string>;
  login(email: string, clave: string): Promise<TestResponse>;
  /** POST multipart/form-data con un archivo en el campo indicado. */
  upload(path: string, options: { token?: string; field?: string; data: Uint8Array; type?: string; filename?: string }): Promise<TestResponse>;
  close(): Promise<void>;
}

export async function startTestApp(options: TestAppOptions = {}): Promise<TestContext> {
  const users = new MemoryUserRepository();
  const resetTokens = new MemoryOneTimeTokenRepository();
  const verificationTokens = new MemoryOneTimeTokenRepository();
  const refreshTokens = new MemoryRefreshTokenRepository();
  const garage = new MemoryGarageRepository();
  const mailer = new CapturingMailer();
  const tokens = new TokenService(TEST_ACCESS_SECRET, TEST_REFRESH_SECRET);
  const clock = { now: new Date() };
  users.onDelete.push((userId) => {
    garage.deleteAllFor(userId);
    for (const [id, row] of refreshTokens.tokens) if (row.userId === userId) refreshTokens.tokens.delete(id);
  });

  const authService = new AuthService({
    users,
    resetTokens,
    verificationTokens,
    refreshTokens,
    hasher: new Argon2PasswordHasher(),
    tokens,
    mailer: options.mailer ?? mailer,
    adminEmails: options.adminEmails ?? [],
    appUrl: 'http://localhost:4200',
    now: () => clock.now
  });
  const garageService = new GarageService(garage);

  const app = createApp({
    config: {
      isProduction: false,
      nodeEnv: 'test',
      corsOrigins: ['http://localhost:4200'],
      cookie: { path: '/auth', sameSite: 'lax', secure: false },
      trustProxy: 0,
      ...options.config
    },
    authService,
    garageService,
    cardScanService: new CardScanService(options.cardReader ?? null, () => 2026),
    tokenService: tokens,
    users,
    rateLimits: { ...NO_RATE_LIMITS, ...options.rateLimits }
  });

  const server: Server = await new Promise((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const request: TestContext['request'] = async (method, path, { body, rawBody, token, cookie, headers: extra } = {}) => {
    const headers: Record<string, string> = { ...extra };
    const payload = rawBody ?? (body === undefined ? undefined : JSON.stringify(body));
    if (payload !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    if (cookie) headers.cookie = cookie;
    const response = await fetch(baseUrl + path, { method, headers, body: payload });
    const text = await response.text();
    const setCookie = response.headers.getSetCookie().find((value) => value.startsWith('autocheck_refresh='));
    return {
      status: response.status,
      body: text ? JSON.parse(text) : null,
      headers: response.headers,
      cookie: setCookie?.split(';')[0]
    };
  };

  const register: TestContext['register'] = (email, clave = DEFAULT_CLAVE) =>
    request('POST', '/auth/register', { body: { email, password: clave, acceptedTerms: true } });

  return {
    users,
    resetTokens,
    verificationTokens,
    refreshTokens,
    garage,
    mailer,
    tokens,
    clock,
    request,
    register,
    async registerVerified(email, clave = DEFAULT_CLAVE) {
      const registered = await register(email, clave);
      if (registered.status !== 201) throw new Error(`Registro falló (${registered.status}): ${JSON.stringify(registered.body)}`);
      const verified = await request('POST', '/auth/verify-email', { body: { token: mailer.lastVerificationToken(registered.body.user.email) } });
      if (verified.status !== 200) throw new Error(`Verificación falló (${verified.status})`);
      return registered.body.accessToken as string;
    },
    login: (email, clave) => request('POST', '/auth/login', { body: { email, password: clave } }),
    async upload(path, { token, field = 'image', data, type = 'application/octet-stream', filename = 'tarjeta.jpg' }) {
      const form = new FormData();
      form.append(field, new Blob([new Uint8Array(data)], { type }), filename);
      const response = await fetch(baseUrl + path, { method: 'POST', body: form, headers: token ? { authorization: `Bearer ${token}` } : {} });
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers, cookie: undefined };
    },
    close: () => new Promise((resolve) => server.close(() => resolve()))
  };
}
