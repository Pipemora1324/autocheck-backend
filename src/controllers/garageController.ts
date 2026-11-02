import type { Request, Response } from 'express';
import { currentUser } from '../middleware/auth.js';
import type { GarageService } from '../services/garageService.js';
import { createGarageVehicleSchema, garagePlateParamsSchema, updateGarageVehicleSchema } from '../validation/garageSchemas.js';

export function createGarageController(service: GarageService) {
  return {
    async list(request: Request, response: Response): Promise<void> {
      response.json({ vehicles: await service.list(currentUser(request).id) });
    },

    async create(request: Request, response: Response): Promise<void> {
      const { plate, source, ...data } = createGarageVehicleSchema.parse(request.body);
      response.status(201).json(await service.create(currentUser(request).id, plate, data, source));
    },

    async get(request: Request, response: Response): Promise<void> {
      const { plate } = garagePlateParamsSchema.parse(request.params);
      response.json(await service.get(currentUser(request).id, plate));
    },

    async update(request: Request, response: Response): Promise<void> {
      const { plate } = garagePlateParamsSchema.parse(request.params);
      const patch = updateGarageVehicleSchema.parse(request.body);
      response.json(await service.update(currentUser(request).id, plate, patch));
    },

    async remove(request: Request, response: Response): Promise<void> {
      const { plate } = garagePlateParamsSchema.parse(request.params);
      await service.remove(currentUser(request).id, plate);
      response.status(204).end();
    },

    async assessment(request: Request, response: Response): Promise<void> {
      const { plate } = garagePlateParamsSchema.parse(request.params);
      response.json(await service.assess(currentUser(request).id, plate));
    }
  };
}

export type GarageController = ReturnType<typeof createGarageController>;
