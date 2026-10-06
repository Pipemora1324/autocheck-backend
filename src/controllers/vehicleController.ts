import type { Request, Response } from 'express';
import { VehicleService } from '../services/vehicleService.js';

const service = new VehicleService();

export function getVehicleController(_request: Request, response: Response): void {
  response.json({ vehicles: service.getVehicles() });
}

export function getVehicleByPlateController(request: Request, response: Response): void {
  const plate = typeof request.params.plate === 'string' ? request.params.plate : '';
  const vehicle = service.getVehicle(plate);
  if (!vehicle) {
    response.status(404).json({ message: 'No se encontró un vehículo con esta placa.', plate });
    return;
  }
  response.json(vehicle);
}

export function scanVehicleController(request: Request, response: Response): void {
  const plate = typeof request.body?.plate === 'string' ? request.body.plate : '';
  const source = request.body?.source === 'image' ? 'image' : 'manual';
  const result = service.scanVehicle(plate, source);
  if (!result) {
    response.status(400).json({ message: 'Ingresa una placa válida en el formato ABC-1234.', plate });
    return;
  }
  response.status(201).json(result);
}

export function updateInspectionController(request: Request, response: Response): void {
  const plate = typeof request.params.plate === 'string' ? request.params.plate : '';
  const update = request.body;
  const vehicle = service.updateInspection(plate, update);
  if (!vehicle) {
    response.status(400).json({ message: 'No se pudo actualizar la inspección. Verifica la placa y los datos enviados.' });
    return;
  }
  response.json(vehicle);
}
