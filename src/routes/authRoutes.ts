import { Router, type RequestHandler } from 'express';
import type { AuthController } from '../controllers/authController.js';
import type { AuthRateLimits } from '../middleware/rateLimit.js';

export function createAuthRoutes(
  controller: AuthController,
  authenticate: RequestHandler,
  limits: AuthRateLimits
): Router {
  const router = Router();

  router.post('/auth/register', limits.register, controller.register);
  router.post('/auth/login', limits.login, limits.loginByEmail, controller.login);
  router.post('/auth/refresh', controller.refresh);
  router.post('/auth/logout', controller.logout);
  router.post('/auth/forgot-password', limits.forgotPassword, limits.forgotPasswordByEmail, controller.forgotPassword);
  router.post('/auth/reset-password', limits.resetPassword, controller.resetPassword);
  router.post('/auth/verify-email', limits.verifyEmail, controller.verifyEmail);
  router.post(
    '/auth/resend-verification',
    limits.resendVerification,
    limits.resendVerificationByEmail,
    controller.resendVerification
  );
  router.get('/auth/me', authenticate, controller.me);
  router.delete('/auth/me', authenticate, limits.deleteAccount, controller.deleteAccount);

  return router;
}
