import type { ScanProviderName } from './cardScanner.js';
import type { TelltaleIdentifier } from './telltaleIdentifier.js';

/**
 * Versión de la política de tratamiento de datos que acepta el usuario al registrarse.
 * Si cambia el texto de la política (README, sección "Tratamiento de datos") o REGISTRATION_CONSENT_TEXT,
 * actualiza esta versión: queda guardada en users.terms_version como evidencia de lo aceptado.
 */
export const PRIVACY_POLICY_VERSION = '2026-11-04.1';

/** Texto que el frontend muestra junto a la casilla de aceptación del registro (GET /config/public). */
export const REGISTRATION_CONSENT_TEXT = [
  'Autorizo a AutoCheck-CO a tratar mis datos personales (correo electrónico y los datos de los vehículos que registre)',
  '(incluido el historial de diagnósticos de testigos del tablero) para crear y administrar mi cuenta, enviarme correos de verificación y recuperación,',
  'y orientarme sobre los testigos del tablero,',
  'según la Ley 1581 de 2012. Puedo consultar, actualizar o eliminar mis datos en cualquier momento.',
  'Si uso la lectura automática de la tarjeta de propiedad, la foto se envía a un proveedor externo de inteligencia artificial',
  'solo para extraer los datos; AutoCheck-CO no la guarda. Con el plan gratuito de Google Gemini, Google puede usar el contenido',
  'enviado para mejorar sus productos. No subiré la tarjeta de otra persona sin su autorización.',
  'Si uso el diagnóstico con inteligencia artificial, la foto del tablero y mi descripción se envían a un proveedor externo de inteligencia artificial',
  'para identificar el testigo; en el plan gratuito de Google Gemini, el proveedor puede usarlas para mejorar sus productos.',
  'La foto no se guarda en los servidores de AutoCheck-CO. El diagnóstico es orientación general y un mecánico debe confirmarlo.'
].join(' ');

/** Aviso que se muestra antes de subir la foto, según el proveedor activo. null si la lectura está apagada. */
export function scanProviderNotice(provider: ScanProviderName | 'none'): string | null {
  if (provider === 'gemini') {
    return 'La foto de la tarjeta se envía a Google (Gemini API, plan gratuito) solo para extraer los datos; AutoCheck-CO no la guarda. '
      + 'En el plan gratuito, Google puede usar el contenido enviado para mejorar sus productos. '
      + 'Sube solo tu propia tarjeta o una que estés autorizado a usar.';
  }
  if (provider === 'anthropic') {
    return 'La foto de la tarjeta se envía a Anthropic (API de Claude) solo para extraer los datos; AutoCheck-CO no la guarda. '
      + 'Anthropic la procesa según sus condiciones de uso de la API. Sube solo tu propia tarjeta o una que estés autorizado a usar.';
  }
  return null;
}

/** Aviso que se muestra antes de subir la foto del tablero. null si la IA está apagada (la elección manual no envía nada). */
export function diagnosisProviderNotice(provider: TelltaleIdentifier['provider'] | 'none'): string | null {
  if (provider !== 'gemini') return null;
  return 'La foto del tablero y tu descripción se envían a un proveedor externo de inteligencia artificial (Google, Gemini API, plan gratuito) para identificar el testigo. '
    + 'En el plan gratuito, Google puede usarlas para mejorar sus productos. La foto no se guarda en nuestros servidores. '
    + 'Evita que aparezcan personas, documentos o la placa. Si prefieres no enviarla, elige el testigo de la lista.';
}
