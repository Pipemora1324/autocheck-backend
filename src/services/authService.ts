import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { badRequest, conflict, unauthorized } from '../errors/httpError.js';
import type {
  PasswordResetTokenRepository,
  RefreshTokenRepository,
  UserRecord,
  UserRepository
} from '../repositories/authRepositories.js';
import type { Mailer } from './mailer.js';
import type { PasswordHasher } from './passwordHasher.js';
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS, type AuthUser, type TokenService } from './tokenService.js';

export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
export const INVALID_CREDENTIALS = 'Credenciales inválidas.';
export const INVALID_RESET_TOKEN = 'El enlace de recuperación no es válido o ya expiró.';
export const INVALID_SESSION = 'La sesión no es válida o expiró. Inicia sesión de nuevo.';

export interface Session {
  user: AuthUser;
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export interface AuthServiceDeps {
  users: UserRepository;
  resetTokens: PasswordResetTokenRepository;
  refreshTokens: RefreshTokenRepository;
  hasher: PasswordHasher;
  tokens: TokenService;
  mailer: Mailer;
  appUrl: string;
  now?: () => Date;
}

export const hashResetToken = (token: string) => createHash('sha256').update(token).digest('hex');

const toAuthUser = (user: UserRecord): AuthUser => ({ id: user.id, email: user.email, role: user.role });

export class AuthService {
  private readonly now: () => Date;
  private dummyHash: Promise<string> | null = null;

  constructor(private readonly deps: AuthServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async register(email: string, password: string): Promise<Session> {
    const passwordHash = await this.deps.hasher.hash(password);
    const user = await this.deps.users.create(email, passwordHash);
    if (!user) throw conflict('Ya existe una cuenta con este correo.');
    return this.startSession(user, randomUUID());
  }

  async login(email: string, password: string): Promise<Session> {
    const user = await this.deps.users.findByEmail(email);
    // Se verifica contra un hash de relleno si el usuario no existe para no revelarlo por el tiempo de respuesta.
    const hash = user?.passwordHash ?? (await this.getDummyHash());
    const valid = await this.deps.hasher.verify(hash, password);
    if (!user || !valid) throw unauthorized(INVALID_CREDENTIALS);
    return this.startSession(user, randomUUID());
  }

  async refresh(refreshToken: string | undefined): Promise<Session> {
    const claims = refreshToken ? this.deps.tokens.verifyRefreshToken(refreshToken) : null;
    if (!claims) throw unauthorized(INVALID_SESSION);

    const now = this.now();
    const record = await this.deps.refreshTokens.revokeIfActive(claims.tokenId, now);
    if (!record) {
      // Un refresh token ya rotado que vuelve a aparecer indica robo: se cierra toda la cadena.
      await this.deps.refreshTokens.revokeFamily(claims.familyId, now);
      throw unauthorized(INVALID_SESSION);
    }

    const user = await this.deps.users.findById(record.userId);
    if (!user) throw unauthorized(INVALID_SESSION);
    return this.startSession(user, record.familyId);
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    const claims = refreshToken ? this.deps.tokens.verifyRefreshToken(refreshToken) : null;
    if (claims) await this.deps.refreshTokens.revokeFamily(claims.familyId, this.now());
  }

  async me(userId: string): Promise<AuthUser & { createdAt: string }> {
    const user = await this.deps.users.findById(userId);
    if (!user) throw unauthorized();
    return { ...toAuthUser(user), createdAt: user.createdAt };
  }

  /** No revela si el correo existe: el controlador responde lo mismo en ambos casos. */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.deps.users.findByEmail(email);
    if (!user) return;

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(this.now().getTime() + RESET_TOKEN_TTL_MS);
    await this.deps.resetTokens.create(user.id, hashResetToken(token), expiresAt);

    const resetUrl = `${this.deps.appUrl}/reset-password?token=${encodeURIComponent(token)}`;
    // Sin await: el tiempo de respuesta no depende del envío del correo.
    this.deps.mailer.sendPasswordReset(user.email, resetUrl).catch((error: Error) => {
      console.error('No se pudo enviar el correo de restablecimiento:', error.message);
    });
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const now = this.now();
    const userId = await this.deps.resetTokens.consume(hashResetToken(token), now);
    if (!userId) throw badRequest(INVALID_RESET_TOKEN);

    await this.deps.users.updatePassword(userId, await this.deps.hasher.hash(newPassword));
    await this.deps.refreshTokens.revokeAllForUser(userId, now);
  }

  private async startSession(user: UserRecord, familyId: string): Promise<Session> {
    const tokenId = randomUUID();
    const refreshExpiresAt = new Date(this.now().getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000);
    await this.deps.refreshTokens.create({ id: tokenId, userId: user.id, familyId }, refreshExpiresAt);

    const authUser = toAuthUser(user);
    return {
      user: authUser,
      accessToken: this.deps.tokens.signAccessToken(authUser),
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      refreshToken: this.deps.tokens.signRefreshToken({ userId: user.id, tokenId, familyId }),
      refreshExpiresAt
    };
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= this.deps.hasher.hash(randomBytes(16).toString('hex'));
    return this.dummyHash;
  }
}
