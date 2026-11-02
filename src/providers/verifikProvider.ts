import type { VehicleLookupInput, VehicleLookupProvider, VehicleLookupResult } from './VehicleLookupProvider.js';

/**
 * Adaptador para Verifik (https://docs.verifik.co). ESQUELETO: todavía no llama a la API.
 *
 * TODO(verifik): implementar lookupByPlate cuando haya un contrato confirmado. La documentación
 * pública revisada el 2026-11-02 es inconsistente y no basta para implementarlo sin adivinar:
 *   - GET https://api.verifik.co/v2/co/runt/vehiculo con query documentType (CC, CE, PA, NIT; una página
 *     agrega RC), documentNumber y plate.
 *     · docs.verifik.co/vehicle-validation/colombia/runt-vehiculo/ documenta la respuesta como
 *       data.vehicle.{marca, linea, modelo, color, cilindraje, noChasis, tipoServicio, estadoDelVehiculo},
 *       sin SOAT ni RTM ni combustible.
 *     · docs.verifik.co/vehicle-validation/colombia/vehicle-s-soat-and-rtm-by-plate-and-identification-document/
 *       documenta para el mismo endpoint data.vehicleInformation, data.soat.{valid, dueDate} y
 *       data.techReview.{valid, dueDate}, con fechas DD/MM/AAAA, y sus ejemplos usan otra ruta
 *       (/v2/co/runt/consultarVehiculo).
 *   - Autenticación: la referencia dice "Authorization: Bearer <token>", pero algunos ejemplos usan "jwt <token>".
 *   - Para SOAT/RTM remiten a GET /v2/co/runt/vehicle-by-plate, cuya respuesta no está documentada públicamente.
 * Pide a Verifik la especificación vigente (o su colección/OpenAPI) y confirma con una consulta de prueba
 * de un vehículo propio antes de implementar. Mapear al implementar: fechas a 'YYYY-MM-DD', 404 → not_found,
 * 401/403/5xx/timeout → unavailable 'error', sin registrar en logs el documento ni la respuesta.
 * La clave va en VERIFIK_API_KEY (variable de entorno de Render), nunca en el repositorio.
 */
export class VerifikVehicleLookupProvider implements VehicleLookupProvider {
  readonly name = 'verifik';
  readonly enabled = true;

  constructor(private readonly apiKey: string) {}

  async lookupByPlate(_input: VehicleLookupInput): Promise<VehicleLookupResult> {
    void this.apiKey;
    return { status: 'unavailable', provider: this.name, reason: 'not_implemented' };
  }
}
