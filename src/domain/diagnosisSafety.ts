// Piso de seguridad del diagnóstico. Vive en el servidor: se aplica sin importar lo que diga el modelo.
import type { ModelTelltale, ModelUrgency, TelltaleCategory } from '../services/telltaleIdentifier.js';

export const DIAGNOSIS_DISCLAIMER = 'Orientación general. Un mecánico debe confirmar el diagnóstico.';
export const NEVER_DRIVE_ACTION =
  'Detente en un lugar seguro en cuanto puedas, apaga el motor y llama a un taller o a una grúa. No sigas manejando.';
export const SAFETY_SYSTEM_ACTION =
  'El vehículo puede moverse, pero esta protección puede no funcionar en un choque. No dependas de ella y llévalo a revisión hoy.';
export const RED_ACTION =
  'Un testigo rojo indica algo serio. Revísalo hoy y, si notas algo raro al manejar, detente en un lugar seguro.';
export const YELLOW_ACTION =
  'Atiéndelo pronto. Si aparece un testigo rojo o notas algo raro al manejar, detente en un lugar seguro.';
export const INFO_ACTION = 'Este testigo informa un estado del vehículo y normalmente no indica una falla.';
export const PARKING_BRAKE_ACTION =
  'Comprueba que el freno de mano esté liberado. Si el testigo sigue encendido con el freno liberado, trátalo como una falla de frenos: detente en un lugar seguro y llama a un taller o a una grúa.';
export const SAFE_STOP_MECHANIC =
  'Ahora: no sigas manejando. Llama a un taller o a una grúa para que lo revisen antes de volver a usar el vehículo.';

/** Con estas categorías siempre se ordena detenerse. */
const STOP_CATEGORIES: ReadonlySet<TelltaleCategory> = new Set([
  'aceite',
  'temperatura',
  'frenos',
  'direccion',
  'bateria_carga'
]);

const RANK: Record<ModelUrgency, number> = { informativo: 0, amarillo: 1, rojo: 2 };
const atLeast = (urgency: ModelUrgency, minimum: ModelUrgency): ModelUrgency =>
  RANK[urgency] >= RANK[minimum] ? urgency : minimum;
export const worstUrgency = (urgencies: readonly ModelUrgency[]): ModelUrgency =>
  urgencies.reduce<ModelUrgency>((worst, item) => atLeast(worst, item), 'informativo');

const DRIVE_ON_PATTERNS = [
  /\b(puedes|podr[ií]as|puede|pod[eé]s|se puede|es seguro|es posible|basta con|intenta|procura)\s+(\w+\s+){0,2}(seguir|continuar|manejar|conducir|circular|rodar|llegar|viajar|ir hasta|ir al|ir a)/i,
  /\b(sigue|segu[ií]|continúa|continua|contin[uú]e|siga)\s+(\w+\s+){0,3}(manejando|conduciendo|circulando|rodando|viajando|tu camino|el viaje|hasta)/i,
  /\b(seguir|continuar)\s+(\w+\s+){0,2}(manejando|conduciendo|circulando|rodando|viajando|hasta)/i,
  /\b(maneja|conduce|circula|rueda|ll[eé]valo|ll[eé]vala)\b\s*(\w+\s+){0,4}(hasta|al taller|a casa|despacio|con cuidado|suave|lentamente|un poco|poco a poco)/i,
  /\b(sin problema|no pasa nada|no es grave|no hay problema|no es urgente)\b/i
];
const NEGATION_BEFORE = /\b(no|nunca|jam[aá]s|evita|evitar|ni|sin)\s+(\w+\s+){0,2}$/i;

/** ¿El texto sugiere seguir manejando? "No sigas manejando" no cuenta. */
export function suggestsDriving(text: string): boolean {
  return DRIVE_ON_PATTERNS.some((pattern) => {
    const match = pattern.exec(text);
    return match !== null && !NEGATION_BEFORE.test(text.slice(0, match.index));
  });
}

const withoutDrivingAdvice = (items: readonly string[]) => items.filter((item) => !suggestsDriving(item));

export interface SafetyContext {
  /** El usuario dijo que el testigo parpadea. */
  blinking?: boolean;
  description?: string;
}

const MENTIONS_BRAKE = /freno/i;
const RELEASED = /liber[eéóa]|solt[eéó]|suelt|baj[eéóa]|quit[eéóa]|abajo/i;
const STILL_ON = /sigue[^.]{0,20}encendid/i;

/**
 * El usuario indica que el freno de mano ya está abajo y el testigo no se apaga.
 * Si se activa de más, solo se pide más precaución.
 */
const saysBrakeReleased = (description: string): boolean =>
  description
    .split(/[.!?\n]/)
    .some((sentence) => MENTIONS_BRAKE.test(sentence) && (RELEASED.test(sentence) || STILL_ON.test(sentence)));

/**
 * Con fotos reales, el modelo clasificó como freno de mano un "Freno de mano o nivel de líquido de frenos" y un "Testigo de frenos".
 * Bajar a amarillo una posible falla de frenos no es aceptable: solo cuenta si el nombre no deja duda.
 */
const isUnambiguousParkingBrake = (name: string): boolean =>
  /freno (de )?(mano|estacionamiento|parqueo)|parking/i.test(name) &&
  !/l[ií]quido|nivel|sistema|falla|\bo\b|\//i.test(name);

export interface FinalTelltale extends Omit<ModelTelltale, 'urgencia'> {
  urgencia: ModelUrgency;
  debeDetenerse: boolean;
  accion: string;
}

/** El freno de mano con el freno liberado es una falla de frenos, y también lo es cualquier duda entre los dos. */
function resolveCategory(telltale: ModelTelltale, description: string | undefined): TelltaleCategory {
  if (telltale.categoria !== 'freno_mano') return telltale.categoria;
  const released = description !== undefined && saysBrakeReleased(description);
  return released || !isUnambiguousParkingBrake(telltale.nombre) ? 'frenos' : 'freno_mano';
}

function mustStop(category: TelltaleCategory, telltale: ModelTelltale, isBlinking: boolean): boolean {
  if (STOP_CATEGORIES.has(category)) return true;
  if (category === 'motor_emisiones') return isBlinking;
  // El catálogo trata la transmisión en rojo como "no sigas manejando", y eso se mantiene.
  return category === 'transmision' && (telltale.urgencia === 'rojo' || telltale.color === 'rojo');
}

const ACTION_BY_URGENCY: Record<ModelUrgency, string> = {
  rojo: RED_ACTION,
  amarillo: YELLOW_ACTION,
  informativo: INFO_ACTION
};

function decideUrgency(
  category: TelltaleCategory,
  telltale: ModelTelltale,
  stop: boolean
): { urgencia: ModelUrgency; accion: string } {
  if (stop) return { urgencia: 'rojo', accion: NEVER_DRIVE_ACTION };
  if (category === 'airbag') return { urgencia: 'rojo', accion: SAFETY_SYSTEM_ACTION };
  if (category === 'freno_mano') {
    // Con el tablero iluminado de rojo, el color no dice nada: este testigo nunca sube de amarillo por sí solo.
    return { urgencia: telltale.urgencia === 'informativo' ? 'informativo' : 'amarillo', accion: PARKING_BRAKE_ACTION };
  }
  // Un símbolo sin identificar en rojo se trata como rojo.
  const urgencia = category === 'otro' && telltale.color === 'rojo' ? 'rojo' : telltale.urgencia;
  return { urgencia, accion: ACTION_BY_URGENCY[urgencia] };
}

/** Quita del texto del modelo todo lo que sugiera seguir manejando. */
function withoutUnsafeText(telltale: ModelTelltale, stop: boolean) {
  const mechanicIsSafe = !suggestsDriving(telltale.cuandoIrAlMecanico);
  const noteIsSafe = telltale.notaDelVehiculo !== null && !suggestsDriving(telltale.notaDelVehiculo);
  return {
    significado: suggestsDriving(telltale.significado) ? '' : telltale.significado,
    porQuePasa: withoutDrivingAdvice(telltale.porQuePasa),
    puedesRevisar: withoutDrivingAdvice(telltale.puedesRevisar),
    noHagas: withoutDrivingAdvice(telltale.noHagas),
    cuandoIrAlMecanico: stop ? SAFE_STOP_MECHANIC : mechanicIsSafe ? telltale.cuandoIrAlMecanico : '',
    notaDelVehiculo: noteIsSafe ? telltale.notaDelVehiculo : null
  };
}

/** Aplica el piso a un testigo. Es el único camino para que un testigo del modelo llegue al usuario. */
export function applySafetyFloor(
  telltale: ModelTelltale,
  { blinking, description }: SafetyContext = {}
): FinalTelltale {
  const categoria = resolveCategory(telltale, description);
  const stop = mustStop(categoria, telltale, blinking === true || telltale.parpadeando === true);
  return {
    ...telltale,
    ...decideUrgency(categoria, telltale, stop),
    ...withoutUnsafeText(telltale, stop),
    categoria,
    debeDetenerse: stop,
    parpadeando: blinking === true ? true : telltale.parpadeando
  };
}

/** Texto general del modelo: se descarta si contradice el piso. */
export const safeGeneralMessage = (message: string): string => (suggestsDriving(message) ? '' : message);
