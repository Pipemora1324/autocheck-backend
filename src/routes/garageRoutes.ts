import { Router, type RequestHandler } from 'express';
import type { GarageController } from '../controllers/garageController.js';

/** Rutas extra del garaje: before se monta antes de las rutas con :plate (por ejemplo, la lectura de tarjeta). */
export interface GarageExtraRoutes {
  before?: (router: Router) => void;
  after?: (router: Router) => void;
}

export function createGarageRoutes(
  controller: GarageController,
  authenticate: RequestHandler,
  requireVerified: RequestHandler,
  extra: GarageExtraRoutes = {}
): Router {
  const router = Router();

  router.use('/garage', authenticate, requireVerified);
  extra.before?.(router);
  router.get('/garage', controller.list);
  router.post('/garage', controller.create);
  router.get('/garage/:plate', controller.get);
  router.patch('/garage/:plate', controller.update);
  router.delete('/garage/:plate', controller.remove);
  router.get('/garage/:plate/assessment', controller.assessment);
  extra.after?.(router);

  return router;
}
