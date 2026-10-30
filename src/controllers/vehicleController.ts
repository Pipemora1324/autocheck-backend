import type { Request, Response } from 'express';
import { currentUser } from '../middleware/auth.js';
import type { VehicleService } from '../services/vehicleService.js';
import { inspectionUpdateSchema, plateParamsSchema, scanSchema } from '../validation/schemas.js';

export function createVehicleController(service: VehicleService) {
  return {
    async list(_request: Request, response: Response): Promise<void> {
      response.json({ vehicles: await service.getVehicles() });
    },

    async getByPlate(request: Request, response: Response): Promise<void> {
      const { plate } = plateParamsSchema.parse(request.params);
      response.json(await service.getVehicle(plate));
    },

    async scan(request: Request, response: Response): Promise<void> {
      const { plate, source } = scanSchema.parse(request.body);
      response.status(201).json(await service.scanVehicle(plate, source));
    },

    async updateInspection(request: Request, response: Response): Promise<void> {
      const { plate } = plateParamsSchema.parse(request.params);
      const update = inspectionUpdateSchema.parse(request.body);
      response.json(await service.updateInspection(plate, update, currentUser(request).id));
    }
  };
}

export type VehicleController = ReturnType<typeof createVehicleController>;
