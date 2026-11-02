export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (message: string, details?: Record<string, unknown>) => new HttpError(400, message, details);
export const unauthorized = (message = 'No autenticado.') => new HttpError(401, message);
export const forbidden = (message = 'No tienes permisos para realizar esta acción.', details?: Record<string, unknown>) =>
  new HttpError(403, message, details);
export const notFound = (message: string, details?: Record<string, unknown>) => new HttpError(404, message, details);
export const conflict = (message: string, details?: Record<string, unknown>) => new HttpError(409, message, details);
export const serviceUnavailable = (message: string, details?: Record<string, unknown>) => new HttpError(503, message, details);
