import { Router, type RequestHandler } from 'express';
import type { VehicleController } from '../controllers/vehicleController.js';
import { requireRole } from '../middleware/auth.js';

export function createVehicleRoutes(controller: VehicleController, authenticate: RequestHandler): Router {
  const router = Router();

  router.use('/vehicles', authenticate);
  router.get('/vehicles', controller.list);
  router.get('/vehicles/:plate', controller.getByPlate);
  router.post('/vehicles/scan', controller.scan);
  router.patch('/vehicles/:plate/inspections', requireRole('admin'), controller.updateInspection);

  return router;
}
