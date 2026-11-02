import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp, type AppDeps } from '../../src/app.js';
import type { RateLimitOptions } from '../../src/middleware/rateLimit.js';
import { AuthService } from '../../src/services/authService.js';
import type { Mailer } from '../../src/services/mailer.js';
import { Argon2PasswordHasher } from '../../src/services/passwordHasher.js';
import { TokenService } from '../../src/services/tokenService.js';
import { VehicleService } from '../../src/services/vehicleService.js';
import { demoVehicles } from './fixtures.js';
import {
  MemoryPasswordResetTokenRepository,
  MemoryRefreshTokenRepository,
  MemoryUserRepository,
  MemoryVehicleRepository
} from './memoryRepositories.js';

// Se generan en cada corrida para no dejar valores con forma de secreto en el repositorio.
export const TEST_ACCESS_SECRET = randomBytes(32).toString('hex');
export const TEST_REFRESH_SECRET = randomBytes(32).toString('hex');
export const DEFAULT_CLAVE = 'contraseña-segura';

export class CapturingMailer implements Mailer {
  readonly sent: Array<{ to: string; resetUrl: string }> = [];

  async sendPasswordReset(to: string, resetUrl: string) {
    this.sent.push({ to, resetUrl });
  }

  lastToken(): string {
    const last = this.sent.at(-1);
    if (!last) throw new Error('No se envió ningún correo');
    return new URL(last.resetUrl).searchParams.get('token')!;
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
  resetPasswordMax: 1000
};

export interface TestAppOptions {
  rateLimits?: RateLimitOptions;
  config?: Partial<AppDeps['config']>;
}

export interface TestContext {
  users: MemoryUserRepository;
  resetTokens: MemoryPasswordResetTokenRepository;
  refreshTokens: MemoryRefreshTokenRepository;
  mailer: CapturingMailer;
  tokens: TokenService;
  clock: { now: Date };
  request(method: string, path: string, options?: RequestOptions): Promise<TestResponse>;
  register(email: string, clave?: string): Promise<TestResponse>;
  login(email: string, clave: string): Promise<TestResponse>;
  close(): Promise<void>;
}

export async function startTestApp(options: TestAppOptions = {}): Promise<TestContext> {
  const users = new MemoryUserRepository();
  const resetTokens = new MemoryPasswordResetTokenRepository();
  const refreshTokens = new MemoryRefreshTokenRepository();
  const mailer = new CapturingMailer();
  const tokens = new TokenService(TEST_ACCESS_SECRET, TEST_REFRESH_SECRET);
  const clock = { now: new Date() };

  const authService = new AuthService({
    users,
    resetTokens,
    refreshTokens,
    hasher: new Argon2PasswordHasher(),
    tokens,
    mailer,
    appUrl: 'http://localhost:4200',
    now: () => clock.now
  });
  const vehicleService = new VehicleService(new MemoryVehicleRepository(demoVehicles(), users), () => new Date('2026-09-15T15:00:00Z'));

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
    vehicleService,
    tokenService: tokens,
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

  return {
    users,
    resetTokens,
    refreshTokens,
    mailer,
    tokens,
    clock,
    request,
    register: (email, clave = DEFAULT_CLAVE) => request('POST', '/auth/register', { body: { email, password: clave } }),
    login: (email, clave) => request('POST', '/auth/login', { body: { email, password: clave } }),
    close: () => new Promise((resolve) => server.close(() => resolve()))
  };
}
