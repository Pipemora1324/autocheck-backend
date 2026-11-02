import type { AppConfig } from '../config/env.js';
import { AnthropicCardScanner } from './anthropicCardScanner.js';
import type { CardScanner } from './cardScanner.js';
import { GeminiCardScanner } from './geminiCardScanner.js';

/** null si SCAN_PROVIDER=none o falta la clave del proveedor elegido: POST /garage/scan-card responde 503. */
export function createCardScanner(config: AppConfig['scan']): CardScanner | null {
  if (config.provider === 'gemini') return new GeminiCardScanner(config);
  if (config.provider === 'anthropic') return new AnthropicCardScanner(config);
  return null;
}
