import type { ErrorRequestHandler, RequestHandler } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';
import { HttpError } from '../errors/httpError.js';

export const notFoundHandler: RequestHandler = (_request, response) => {
  response.status(404).json({ message: 'No se encontró la ruta solicitada.' });
};

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof ZodError) {
    response.status(400).json({
      message: 'Los datos enviados no son válidos.',
      errors: error.issues.flatMap((issue) =>
        // Esquemas estrictos: cada campo desconocido se reporta por separado y en español.
        issue.code === 'unrecognized_keys'
          ? issue.keys.map((key) => ({ field: [...issue.path, key].join('.'), message: 'Este campo no está permitido.' }))
          : [{ field: issue.path.join('.'), message: issue.message }]
      )
    });
    return;
  }

  if (error instanceof multer.MulterError) {
    const tooLarge = error.code === 'LIMIT_FILE_SIZE';
    const invalidUpload = error.code === 'LIMIT_FIELD_VALUE' ? 'Un campo de texto supera el tamaño permitido.' : 'Envía una sola imagen en el campo "image" (multipart/form-data).';
    response.status(tooLarge ? 413 : 400).json({
      message: tooLarge ? 'La imagen supera el máximo de 5 MB.' : invalidUpload,
      code: tooLarge ? 'IMAGE_TOO_LARGE' : 'INVALID_UPLOAD'
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

  // Sin el objeto completo: los errores de Postgres traen en "detail" los valores de la fila.
  const { code, stack, message } = error as { code?: unknown; stack?: string; message?: string };
  console.error('Error no controlado:', code ?? '', stack ?? message ?? 'sin detalle');
  response.status(500).json({ message: 'Ocurrió un error inesperado. Intenta de nuevo más tarde.' });
};
