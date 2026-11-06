import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { forbidden, unauthorized } from '../errors/httpError.js';
import type { UserRepository } from '../repositories/authRepositories.js';
import type { AuthUser, TokenService } from '../services/tokenService.js';

export function requireAuth(tokens: TokenService): RequestHandler {
  return (request: Request, _response: Response, next: NextFunction) => {
    const header = request.get('authorization') ?? '';
    const [scheme, token] = header.split(' ');
    const user = scheme.toLowerCase() === 'bearer' && token ? tokens.verifyAccessToken(token) : null;
    if (!user) {
      next(unauthorized('Debes iniciar sesión para acceder a este recurso.'));
      return;
    }
    request.user = user;
    next();
  };
}

export const EMAIL_NOT_VERIFIED = 'EMAIL_NOT_VERIFIED';

/**
 * Exige correo verificado. Se consulta la base en cada petición (y no un claim del token) para que
 * el acceso se habilite apenas el usuario confirma su correo, sin esperar a renovar el token.
 */
export function requireVerifiedEmail(users: UserRepository): RequestHandler {
  return async (request: Request, _response: Response, next: NextFunction) => {
    if (!request.user) {
      next(unauthorized());
      return;
    }
    const user = await users.findById(request.user.id);
    if (!user) {
      next(unauthorized());
      return;
    }
    next(user.emailVerifiedAt ? undefined : forbidden('Confirma tu correo para usar esta función. Revisa tu bandeja de entrada o solicita un nuevo enlace.', { code: EMAIL_NOT_VERIFIED }));
  };
}

export function currentUser(request: Request): AuthUser {
  if (!request.user) throw unauthorized();
  return request.user;
}
