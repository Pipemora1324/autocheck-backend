import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { badRequest, conflict, forbidden, unauthorized } from '../errors/httpError.js';
import type {
  EmailVerificationTokenRepository,
  PasswordResetTokenRepository,
  RefreshTokenRepository,
  UserRecord,
  UserRepository
} from '../repositories/authRepositories.js';
import type { Mailer } from './mailer.js';
import type { PasswordHasher } from './passwordHasher.js';
import { PRIVACY_POLICY_VERSION } from './privacyPolicy.js';
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS, type AuthUser, type TokenService } from './tokenService.js';

export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
export const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
export const INVALID_CREDENTIALS = 'Credenciales inválidas.';
export const INVALID_RESET_TOKEN = 'El enlace de recuperación no es válido o ya expiró.';
export const INVALID_VERIFICATION_TOKEN = 'El enlace de verificación no es válido o ya expiró. Solicita uno nuevo.';
export const WRONG_PASSWORD_CODE = 'INVALID_PASSWORD';
export const INVALID_SESSION = 'La sesión no es válida o expiró. Inicia sesión de nuevo.';

/** Usuario tal como se entrega al cliente (el access token solo lleva id, email y rol). */
export interface PublicUser extends AuthUser {
  emailVerified: boolean;
}

export interface Session {
  user: PublicUser;
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export interface AuthServiceDeps {
  users: UserRepository;
  resetTokens: PasswordResetTokenRepository;
  verificationTokens: EmailVerificationTokenRepository;
  refreshTokens: RefreshTokenRepository;
  hasher: PasswordHasher;
  tokens: TokenService;
  mailer: Mailer;
  appUrl: string;
  now?: () => Date;
}

/** sha256 de un token de un solo uso: en la base nunca se guarda el token en claro. */
export const hashResetToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const hashOneTimeToken = hashResetToken;

const newOneTimeToken = () => randomBytes(32).toString('base64url');

const toAuthUser = (user: UserRecord): AuthUser => ({ id: user.id, email: user.email, role: user.role });
const toPublicUser = (user: UserRecord): PublicUser => ({ ...toAuthUser(user), emailVerified: user.emailVerifiedAt !== null });

export class AuthService {
  private readonly now: () => Date;
  private dummyHash: Promise<string> | null = null;

  constructor(private readonly deps: AuthServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /** El controlador ya exige acceptedTerms === true; aquí se deja evidencia de la fecha y la versión aceptada. */
  async register(email: string, password: string): Promise<Session> {
    const passwordHash = await this.deps.hasher.hash(password);
    const user = await this.deps.users.create({
      email,
      passwordHash,
      termsAcceptedAt: this.now(),
      termsVersion: PRIVACY_POLICY_VERSION
    });
    if (!user) throw conflict('Ya existe una cuenta con este correo.');
    await this.sendVerification(user);
    return this.startSession(user, randomUUID());
  }

  async verifyEmail(token: string): Promise<void> {
    const now = this.now();
    const userId = await this.deps.verificationTokens.consume(hashOneTimeToken(token), now);
    if (!userId) throw badRequest(INVALID_VERIFICATION_TOKEN);
    await this.deps.users.markEmailVerified(userId, now);
  }

  /** No revela si el correo existe ni si ya estaba verificado: el controlador responde siempre lo mismo. */
  async resendVerification(email: string): Promise<void> {
    const user = await this.deps.users.findByEmail(email);
    if (!user || user.emailVerifiedAt) return;
    await this.sendVerification(user);
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

  async me(userId: string): Promise<PublicUser & { createdAt: string; termsAcceptedAt: string | null; termsVersion: string | null }> {
    const user = await this.deps.users.findById(userId);
    if (!user) throw unauthorized();
    return { ...toPublicUser(user), createdAt: user.createdAt, termsAcceptedAt: user.termsAcceptedAt, termsVersion: user.termsVersion };
  }

  /**
   * Borra la cuenta y, en cascada, sus sesiones, tokens y vehículos del garaje. Exige la contraseña
   * actual: un access token robado no basta para borrar la cuenta.
   */
  async deleteAccount(userId: string, password: string): Promise<void> {
    const user = await this.deps.users.findById(userId);
    if (!user) throw unauthorized();
    // 403 y no 401: un 401 haría que el frontend intente renovar la sesión y luego la cierre.
    if (!(await this.deps.hasher.verify(user.passwordHash, password))) {
      throw forbidden('La contraseña no es correcta.', { code: WRONG_PASSWORD_CODE });
    }
    await this.deps.refreshTokens.revokeAllForUser(userId, this.now());
    await this.deps.users.delete(userId);
  }

  /** No revela si el correo existe: el controlador responde lo mismo en ambos casos. */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.deps.users.findByEmail(email);
    if (!user) return;

    const token = newOneTimeToken();
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

    return {
      user: toPublicUser(user),
      accessToken: this.deps.tokens.signAccessToken(toAuthUser(user)),
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      refreshToken: this.deps.tokens.signRefreshToken({ userId: user.id, tokenId, familyId }),
      refreshExpiresAt
    };
  }

  private async sendVerification(user: UserRecord): Promise<void> {
    const token = newOneTimeToken();
    const expiresAt = new Date(this.now().getTime() + VERIFICATION_TOKEN_TTL_MS);
    await this.deps.verificationTokens.create(user.id, hashOneTimeToken(token), expiresAt);

    const verifyUrl = `${this.deps.appUrl}/verify-email?token=${encodeURIComponent(token)}`;
    // Sin await: ni el registro ni el reenvío dependen de que el proveedor de correo responda.
    this.deps.mailer.sendEmailVerification(user.email, verifyUrl).catch((error: Error) => {
      console.error('No se pudo enviar el correo de verificación:', error.message);
    });
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= this.deps.hasher.hash(randomBytes(16).toString('hex'));
    return this.dummyHash;
  }
}
