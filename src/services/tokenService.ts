import jwt from 'jsonwebtoken';
import { z } from 'zod';
import type { UserRole } from '../repositories/authRepositories.js';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

const ISSUER = 'autocheck-api';
const ACCESS_AUDIENCE = 'autocheck-app';
const REFRESH_AUDIENCE = 'autocheck-refresh';

const accessPayloadSchema = z.object({ sub: z.uuid(), email: z.string(), role: z.enum(['user', 'admin']) });
const refreshPayloadSchema = z.object({ sub: z.uuid(), jti: z.uuid(), fam: z.uuid() });

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}

export interface RefreshClaims {
  userId: string;
  tokenId: string;
  familyId: string;
}

export class TokenService {
  constructor(
    private readonly accessSecret: string,
    private readonly refreshSecret: string
  ) {}

  signAccessToken(user: AuthUser): string {
    return jwt.sign({ email: user.email, role: user.role }, this.accessSecret, {
      algorithm: 'HS256',
      subject: user.id,
      issuer: ISSUER,
      audience: ACCESS_AUDIENCE,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS
    });
  }

  /** Devuelve null si el token es inválido, expiró o no tiene la forma esperada. */
  verifyAccessToken(token: string): AuthUser | null {
    try {
      const decoded = jwt.verify(token, this.accessSecret, { algorithms: ['HS256'], issuer: ISSUER, audience: ACCESS_AUDIENCE });
      const payload = accessPayloadSchema.parse(decoded);
      return { id: payload.sub, email: payload.email, role: payload.role };
    } catch {
      return null;
    }
  }

  signRefreshToken(claims: RefreshClaims): string {
    return jwt.sign({ fam: claims.familyId }, this.refreshSecret, {
      algorithm: 'HS256',
      subject: claims.userId,
      jwtid: claims.tokenId,
      issuer: ISSUER,
      audience: REFRESH_AUDIENCE,
      expiresIn: REFRESH_TOKEN_TTL_SECONDS
    });
  }

  verifyRefreshToken(token: string): RefreshClaims | null {
    try {
      const decoded = jwt.verify(token, this.refreshSecret, { algorithms: ['HS256'], issuer: ISSUER, audience: REFRESH_AUDIENCE });
      const payload = refreshPayloadSchema.parse(decoded);
      return { userId: payload.sub, tokenId: payload.jti, familyId: payload.fam };
    } catch {
      return null;
    }
  }
}
