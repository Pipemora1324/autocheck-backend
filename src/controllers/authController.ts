import type { CookieOptions, Request, Response } from 'express';
import type { CookieConfig } from '../config/env.js';
import { currentUser } from '../middleware/auth.js';
import type { AuthService, Session } from '../services/authService.js';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  verifyEmailSchema
} from '../validation/schemas.js';

export const REFRESH_COOKIE = 'autocheck_refresh';
export const FORGOT_PASSWORD_MESSAGE = 'Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.';
export const RESEND_VERIFICATION_MESSAGE = 'Si el correo está registrado y aún no se ha confirmado, recibirás un nuevo enlace de verificación.';

export function createAuthController(service: AuthService, cookie: CookieConfig) {
  // Detrás del rewrite de Vercel (/api/* → Render) el navegador ve /api/auth/...: la ruta de la cookie
  // debe coincidir con esa URL (COOKIE_PATH=/api/auth) y, al ser mismo origen, basta SameSite=Strict.
  const cookieOptions: CookieOptions = {
    httpOnly: true,
    secure: cookie.secure,
    sameSite: cookie.sameSite,
    path: cookie.path
  };

  const sendSession = (response: Response, session: Session, status = 200) => {
    response
      .cookie(REFRESH_COOKIE, session.refreshToken, { ...cookieOptions, expires: session.refreshExpiresAt })
      .status(status)
      .json({ user: session.user, accessToken: session.accessToken, tokenType: 'Bearer', expiresIn: session.expiresIn });
  };

  const refreshCookie = (request: Request): string | undefined => {
    const value: unknown = request.cookies?.[REFRESH_COOKIE];
    return typeof value === 'string' ? value : undefined;
  };

  return {
    async register(request: Request, response: Response): Promise<void> {
      const { email, password } = registerSchema.parse(request.body);
      sendSession(response, await service.register(email, password), 201);
    },

    async login(request: Request, response: Response): Promise<void> {
      const { email, password } = loginSchema.parse(request.body);
      sendSession(response, await service.login(email, password));
    },

    async refresh(request: Request, response: Response): Promise<void> {
      try {
        sendSession(response, await service.refresh(refreshCookie(request)));
      } catch (error) {
        response.clearCookie(REFRESH_COOKIE, cookieOptions);
        throw error;
      }
    },

    async logout(request: Request, response: Response): Promise<void> {
      await service.logout(refreshCookie(request));
      response.clearCookie(REFRESH_COOKIE, cookieOptions).status(204).end();
    },

    async me(request: Request, response: Response): Promise<void> {
      response.json({ user: await service.me(currentUser(request).id) });
    },

    async forgotPassword(request: Request, response: Response): Promise<void> {
      const { email } = forgotPasswordSchema.parse(request.body);
      await service.forgotPassword(email);
      response.status(202).json({ message: FORGOT_PASSWORD_MESSAGE });
    },

    async resetPassword(request: Request, response: Response): Promise<void> {
      const { token, password } = resetPasswordSchema.parse(request.body);
      await service.resetPassword(token, password);
      response.json({ message: 'Tu contraseña fue actualizada. Ya puedes iniciar sesión.' });
    },

    async verifyEmail(request: Request, response: Response): Promise<void> {
      const { token } = verifyEmailSchema.parse(request.body);
      await service.verifyEmail(token);
      response.json({ message: 'Tu correo fue confirmado.', emailVerified: true });
    },

    async resendVerification(request: Request, response: Response): Promise<void> {
      const { email } = resendVerificationSchema.parse(request.body);
      await service.resendVerification(email);
      response.status(202).json({ message: RESEND_VERIFICATION_MESSAGE });
    }
  };
}

export type AuthController = ReturnType<typeof createAuthController>;
