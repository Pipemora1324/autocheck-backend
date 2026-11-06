import type { Request, Response } from 'express';
import { telltaleSummaries } from '../data/telltales.js';

export function createTelltaleController() {
  return {
    /** GET /telltales: catálogo resumido para elegir el testigo a mano si la foto no se reconoce. */
    list: (_request: Request, response: Response): void => {
      response.json({ telltales: telltaleSummaries() });
    }
  };
}
