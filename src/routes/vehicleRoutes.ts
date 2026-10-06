import { Router } from 'express';
import {
  getVehicleByPlateController,
  getVehicleController,
  scanVehicleController,
  updateInspectionController
} from '../controllers/vehicleController.js';

export function createVehicleRoutes(): Router {
  const router = Router();

  router.get('/vehicles', getVehicleController);
  router.get('/vehicles/:plate', getVehicleByPlateController);
  router.post('/vehicles/scan', scanVehicleController);
  router.patch('/vehicles/:plate/inspections', updateInspectionController);

  return router;
}
