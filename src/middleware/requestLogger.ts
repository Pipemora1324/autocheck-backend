import type { IncomingMessage } from 'node:http';
import type { RequestHandler } from 'express';
import morgan from 'morgan';

// Todo lo que va tras /garage/ es una placa, salvo las rutas fijas. Detrás de Vercel la ruta puede llegar con /api.
const PLATE_IN_PATH = /^((?:\/api)?\/garage\/)(?!(?:scan-card|capabilities)(?:\/|$))[^/]+/;

/** Quita de la URL lo que no debe llegar a los logs: la placa y la cadena de consulta. */
export function sanitizeUrlForLog(url: string): string {
  return url.split('?')[0].replace(PLATE_IN_PATH, '$1:plate');
}

morgan.token('safe-url', (request: IncomingMessage & { originalUrl?: string }) =>
  sanitizeUrlForLog(request.originalUrl ?? request.url ?? '')
);

// Sin la URL original ni el Referer de los formatos estándar: ambos pueden contener la placa.
const PRODUCTION_FORMAT = ':remote-addr :method :safe-url :status :res[content-length] - :response-time ms';
const DEVELOPMENT_FORMAT = ':method :safe-url :status :response-time ms';

export function requestLogger(isProduction: boolean, stream?: { write(line: string): void }): RequestHandler {
  return morgan(isProduction ? PRODUCTION_FORMAT : DEVELOPMENT_FORMAT, stream ? { stream } : {});
}
