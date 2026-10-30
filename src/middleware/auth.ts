import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { forbidden, unauthorized } from '../errors/httpError.js';
import type { UserRole } from '../repositories/authRepositories.js';
import type { AuthUser, TokenService } from '../services/tokenService.js';

export function requireAuth(tokens: TokenService): RequestHandler {
  return (request: Request, _response: Response, next: NextFunction) => {
    const header = request.get('authorization') ?? '';
    const [scheme, token] = header.split(' ');
    const user = scheme?.toLowerCase() === 'bearer' && token ? tokens.verifyAccessToken(token) : null;
    if (!user) {
      next(unauthorized('Debes iniciar sesión para acceder a este recurso.'));
      return;
    }
    request.user = user;
    next();
  };
}

export function requireRole(...roles: UserRole[]): RequestHandler {
  return (request: Request, _response: Response, next: NextFunction) => {
    if (!request.user) {
      next(unauthorized());
      return;
    }
    next(roles.includes(request.user.role) ? undefined : forbidden());
  };
}

export function currentUser(request: Request): AuthUser {
  if (!request.user) throw unauthorized();
  return request.user;
}
