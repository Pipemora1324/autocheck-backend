import type pg from 'pg';
import type {
  NewUser,
  OneTimeTokenRepository,
  RefreshTokenRecord,
  RefreshTokenRepository,
  UserRecord,
  UserRepository,
  UserRole
} from './authRepositories.js';

const UNIQUE_VIOLATION = '23505';

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  role: UserRole;
  email_verified_at: Date | null;
  terms_accepted_at: Date | null;
  terms_version: string | null;
  created_at: Date;
}

const toUser = (row: UserRow): UserRecord => ({
  id: row.id,
  email: row.email,
  passwordHash: row.password_hash,
  role: row.role,
  emailVerifiedAt: row.email_verified_at?.toISOString() ?? null,
  termsAcceptedAt: row.terms_accepted_at?.toISOString() ?? null,
  termsVersion: row.terms_version,
  createdAt: row.created_at.toISOString()
});

export class PgUserRepository implements UserRepository {
  constructor(private readonly pool: pg.Pool) {}

  async findByEmail(email: string): Promise<UserRecord | null> {
    const { rows } = await this.pool.query<UserRow>('SELECT * FROM users WHERE email = $1', [email]);
    return rows[0] ? toUser(rows[0]) : null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    const { rows } = await this.pool.query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
    return rows[0] ? toUser(rows[0]) : null;
  }

  async create(user: NewUser): Promise<UserRecord | null> {
    try {
      const { rows } = await this.pool.query<UserRow>(
        'INSERT INTO users (email, password_hash, terms_accepted_at, terms_version) VALUES ($1, $2, $3, $4) RETURNING *',
        [user.email, user.passwordHash, user.termsAcceptedAt, user.termsVersion]
      );
      return toUser(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) return null;
      throw error;
    }
  }

  async updatePassword(id: string, passwordHash: string): Promise<void> {
    await this.pool.query('UPDATE users SET password_hash = $2 WHERE id = $1', [id, passwordHash]);
  }

  async markEmailVerified(id: string, at: Date): Promise<void> {
    await this.pool.query('UPDATE users SET email_verified_at = COALESCE(email_verified_at, $2) WHERE id = $1', [id, at]);
  }

  async updateRole(id: string, role: UserRole): Promise<void> {
    await this.pool.query('UPDATE users SET role = $2 WHERE id = $1', [id, role]);
  }

  async delete(id: string): Promise<void> {
    await this.pool.query('DELETE FROM users WHERE id = $1', [id]);
  }
}

// Nombres de tabla fijos (no vienen del usuario): es seguro interpolarlos en el SQL.
type OneTimeTokenTable = 'password_reset_tokens' | 'email_verification_tokens';

class PgOneTimeTokenRepository implements OneTimeTokenRepository {
  constructor(
    private readonly pool: pg.Pool,
    private readonly table: OneTimeTokenTable
  ) {}

  async create(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.pool.query(`INSERT INTO ${this.table} (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`, [userId, tokenHash, expiresAt]);
  }

  async consume(tokenHash: string, now: Date): Promise<string | null> {
    // Un solo UPDATE condicional garantiza el uso único aunque lleguen dos solicitudes a la vez.
    const { rows } = await this.pool.query<{ user_id: string }>(
      `WITH consumed AS (
         UPDATE ${this.table} SET used_at = $2
         WHERE token_hash = $1 AND used_at IS NULL AND expires_at > $2
         RETURNING user_id
       ), invalidated AS (
         UPDATE ${this.table} SET used_at = $2
         WHERE user_id IN (SELECT user_id FROM consumed) AND token_hash <> $1 AND used_at IS NULL
       )
       SELECT user_id FROM consumed`,
      [tokenHash, now]
    );
    return rows[0]?.user_id ?? null;
  }
}

export class PgPasswordResetTokenRepository extends PgOneTimeTokenRepository {
  constructor(pool: pg.Pool) {
    super(pool, 'password_reset_tokens');
  }
}

export class PgEmailVerificationTokenRepository extends PgOneTimeTokenRepository {
  constructor(pool: pg.Pool) {
    super(pool, 'email_verification_tokens');
  }
}

export class PgRefreshTokenRepository implements RefreshTokenRepository {
  constructor(private readonly pool: pg.Pool) {}

  async create(token: RefreshTokenRecord, expiresAt: Date): Promise<void> {
    await this.pool.query(
      'INSERT INTO refresh_tokens (id, user_id, family_id, expires_at) VALUES ($1, $2, $3, $4)',
      [token.id, token.userId, token.familyId, expiresAt]
    );
  }

  async revokeIfActive(id: string, now: Date): Promise<RefreshTokenRecord | null> {
    const { rows } = await this.pool.query<{ id: string; user_id: string; family_id: string }>(
      `UPDATE refresh_tokens SET revoked_at = $2
       WHERE id = $1 AND revoked_at IS NULL AND expires_at > $2
       RETURNING id, user_id, family_id`,
      [id, now]
    );
    return rows[0] ? { id: rows[0].id, userId: rows[0].user_id, familyId: rows[0].family_id } : null;
  }

  async revokeFamily(familyId: string, now: Date): Promise<void> {
    await this.pool.query('UPDATE refresh_tokens SET revoked_at = $2 WHERE family_id = $1 AND revoked_at IS NULL', [familyId, now]);
  }

  async revokeAllForUser(userId: string, now: Date): Promise<void> {
    await this.pool.query('UPDATE refresh_tokens SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL', [userId, now]);
  }
}
