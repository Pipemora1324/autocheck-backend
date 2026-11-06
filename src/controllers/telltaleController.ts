import type { Request, Response } from 'express';
import { telltaleSummaries } from '../data/telltales.js';
import { CACHE_TTL_SECONDS, cached, cacheKeys, type Cache } from '../services/cache.js';

export function createTelltaleController(cache: Cache) {
  return {
    /** GET /telltales: catálogo resumido para elegir el testigo a mano si la foto no se reconoce. */
    list: async (_request: Request, response: Response): Promise<void> => {
      const telltales = await cached(cache, cacheKeys.telltales, CACHE_TTL_SECONDS.catalog, () =>
        Promise.resolve(telltaleSummaries())
      );
      response.json({ telltales });
    }
  };
}
