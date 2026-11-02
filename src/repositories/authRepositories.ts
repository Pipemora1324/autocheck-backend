export type UserRole = 'user' | 'admin';

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  emailVerifiedAt: string | null;
  termsAcceptedAt: string | null;
  termsVersion: string | null;
  createdAt: string;
}

export interface NewUser {
  email: string;
  passwordHash: string;
  termsAcceptedAt: Date;
  termsVersion: string;
}

export interface UserRepository {
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  /** Devuelve null si el correo ya está registrado. */
  create(user: NewUser): Promise<UserRecord | null>;
  updatePassword(id: string, passwordHash: string): Promise<void>;
  /** Marca el correo como verificado; si ya lo estaba, conserva la fecha original. */
  markEmailVerified(id: string, at: Date): Promise<void>;
  /** Borra la cuenta; sesiones, tokens y vehículos del garaje se eliminan en cascada. */
  delete(id: string): Promise<void>;
}

/** Tokens de un solo uso (recuperación de contraseña, verificación de correo): solo se guarda su hash. */
export interface OneTimeTokenRepository {
  create(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  /**
   * Marca como usado el token si está vigente y sin usar, e invalida los demás tokens
   * pendientes del mismo usuario. Devuelve el id del usuario, o null si el token no sirve.
   */
  consume(tokenHash: string, now: Date): Promise<string | null>;
}

export type PasswordResetTokenRepository = OneTimeTokenRepository;
export type EmailVerificationTokenRepository = OneTimeTokenRepository;

export interface RefreshTokenRecord {
  id: string;
  userId: string;
  familyId: string;
}

export interface RefreshTokenRepository {
  create(token: RefreshTokenRecord, expiresAt: Date): Promise<void>;
  /** Revoca el token solo si está activo; devuelve el registro revocado o null. */
  revokeIfActive(id: string, now: Date): Promise<RefreshTokenRecord | null>;
  revokeFamily(familyId: string, now: Date): Promise<void>;
  revokeAllForUser(userId: string, now: Date): Promise<void>;
}
