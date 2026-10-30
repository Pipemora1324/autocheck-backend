import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../errors/httpError.js';

export const notFoundHandler: RequestHandler = (_request, response) => {
  response.status(404).json({ message: 'No se encontró la ruta solicitada.' });
};

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof ZodError) {
    response.status(400).json({
      message: 'Los datos enviados no son válidos.',
      errors: error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message }))
    });
    return;
  }

  if (error instanceof HttpError) {
    response.status(error.status).json({ message: error.message, ...error.details });
    return;
  }

  // Errores de body-parser (JSON mal formado, cuerpo demasiado grande).
  const status = (error as { status?: number }).status;
  if (status === 400 || status === 413) {
    response.status(status).json({ message: status === 413 ? 'La solicitud es demasiado grande.' : 'El cuerpo de la solicitud no es JSON válido.' });
    return;
  }

  console.error('Error no controlado:', error);
  response.status(500).json({ message: 'Ocurrió un error inesperado. Intenta de nuevo más tarde.' });
};
