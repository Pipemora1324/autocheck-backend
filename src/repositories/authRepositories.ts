export type UserRole = 'user' | 'admin';

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  createdAt: string;
}

export interface UserRepository {
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  /** Devuelve null si el correo ya está registrado. */
  create(email: string, passwordHash: string): Promise<UserRecord | null>;
  updatePassword(id: string, passwordHash: string): Promise<void>;
}

export interface PasswordResetTokenRepository {
  create(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  /**
   * Marca como usado el token si está vigente y sin usar, e invalida los demás tokens
   * pendientes del mismo usuario. Devuelve el id del usuario, o null si el token no sirve.
   */
  consume(tokenHash: string, now: Date): Promise<string | null>;
}

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
