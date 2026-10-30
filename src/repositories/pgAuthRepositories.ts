import type pg from 'pg';
import type {
  PasswordResetTokenRepository,
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
  created_at: Date;
}

const toUser = (row: UserRow): UserRecord => ({
  id: row.id,
  email: row.email,
  passwordHash: row.password_hash,
  role: row.role,
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

  async create(email: string, passwordHash: string): Promise<UserRecord | null> {
    try {
      const { rows } = await this.pool.query<UserRow>(
        'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING *',
        [email, passwordHash]
      );
      return toUser(rows[0]!);
    } catch (error) {
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) return null;
      throw error;
    }
  }

  async updatePassword(id: string, passwordHash: string): Promise<void> {
    await this.pool.query('UPDATE users SET password_hash = $2 WHERE id = $1', [id, passwordHash]);
  }
}

export class PgPasswordResetTokenRepository implements PasswordResetTokenRepository {
  constructor(private readonly pool: pg.Pool) {}

  async create(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.pool.query(
      'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [userId, tokenHash, expiresAt]
    );
  }

  async consume(tokenHash: string, now: Date): Promise<string | null> {
    // Un solo UPDATE condicional garantiza el uso único aunque lleguen dos solicitudes a la vez.
    const { rows } = await this.pool.query<{ user_id: string }>(
      `WITH consumed AS (
         UPDATE password_reset_tokens SET used_at = $2
         WHERE token_hash = $1 AND used_at IS NULL AND expires_at > $2
         RETURNING user_id
       ), invalidated AS (
         UPDATE password_reset_tokens SET used_at = $2
         WHERE user_id IN (SELECT user_id FROM consumed) AND token_hash <> $1 AND used_at IS NULL
       )
       SELECT user_id FROM consumed`,
      [tokenHash, now]
    );
    return rows[0]?.user_id ?? null;
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
    const row = rows[0];
    return row ? { id: row.id, userId: row.user_id, familyId: row.family_id } : null;
  }

  async revokeFamily(familyId: string, now: Date): Promise<void> {
    await this.pool.query('UPDATE refresh_tokens SET revoked_at = $2 WHERE family_id = $1 AND revoked_at IS NULL', [familyId, now]);
  }

  async revokeAllForUser(userId: string, now: Date): Promise<void> {
    await this.pool.query('UPDATE refresh_tokens SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL', [userId, now]);
  }
}
