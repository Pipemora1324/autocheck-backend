import type { Request, Response } from 'express';
import { currentUser } from '../middleware/auth.js';
import type { GarageService } from '../services/garageService.js';
import {
  createGarageVehicleSchema,
  garagePlateParamsSchema,
  updateGarageVehicleSchema
} from '../validation/garageSchemas.js';

export function createGarageController(service: GarageService) {
  return {
    list: async (request: Request, response: Response): Promise<void> => {
      response.json({ vehicles: await service.list(currentUser(request).id) });
    },

    create: async (request: Request, response: Response): Promise<void> => {
      const { plate, source, ...data } = createGarageVehicleSchema.parse(request.body);
      response.status(201).json(await service.create(currentUser(request).id, plate, data, source));
    },

    get: async (request: Request, response: Response): Promise<void> => {
      const { plate } = garagePlateParamsSchema.parse(request.params);
      response.json(await service.get(currentUser(request).id, plate));
    },

    update: async (request: Request, response: Response): Promise<void> => {
      const { plate } = garagePlateParamsSchema.parse(request.params);
      const patch = updateGarageVehicleSchema.parse(request.body);
      response.json(await service.update(currentUser(request).id, plate, patch));
    },

    remove: async (request: Request, response: Response): Promise<void> => {
      const { plate } = garagePlateParamsSchema.parse(request.params);
      await service.remove(currentUser(request).id, plate);
      response.status(204).end();
    }
  };
}

export type GarageController = ReturnType<typeof createGarageController>;
