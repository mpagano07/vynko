import { EXPORT_FORMAT_LABELS, EXPORT_PLATFORM_LABELS } from '@/lib/excel-export';
import type { ExportFormat, ExportPlatform } from '@/lib/excel-export';

/**
 * Acción que quedó pendiente cuando hubo que mandar al usuario a autorizar
 * Google Drive.
 *
 * El flujo de OAuth es una navegación completa (`window.location.href`), así
 * que la página se recarga y se pierde el estado de React. Guardar la intención
 * en `sessionStorage` permite retomar el export o el import al volver, en vez
 * de dejar al usuario con un toast de "conectado" y obligarlo a empezar de
 * nuevo.
 */
export type DriveIntent =
  | { kind: 'export'; platform: ExportPlatform; format: ExportFormat }
  | { kind: 'import' };

const STORAGE_KEY = 'vynko:drive-intent';

/** Una intención vieja ya no representa lo que el usuario está haciendo. */
const MAX_AGE_MS = 10 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isExportPlatform(value: unknown): value is ExportPlatform {
  return typeof value === 'string' && value in EXPORT_PLATFORM_LABELS;
}

function isExportFormat(value: unknown): value is ExportFormat {
  return typeof value === 'string' && value in EXPORT_FORMAT_LABELS;
}

function parseIntent(value: unknown): DriveIntent | null {
  if (!isRecord(value)) return null;

  const savedAt = value.savedAt;
  if (typeof savedAt !== 'number' || !Number.isFinite(savedAt)) return null;
  const age = Date.now() - savedAt;
  if (age < 0 || age > MAX_AGE_MS) return null;

  if (value.kind === 'import') return { kind: 'import' };
  if (
    value.kind === 'export' &&
    isExportPlatform(value.platform) &&
    isExportFormat(value.format)
  ) {
    return { kind: 'export', platform: value.platform, format: value.format };
  }

  return null;
}

export function rememberDriveIntent(intent: DriveIntent): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...intent, savedAt: Date.now() })
    );
  } catch {
    // Storage lleno o bloqueado: se pierde la reanudación, no el flujo.
  }
}

/** Lee la intención pendiente y la borra: sólo se reanuda una vez. */
export function takeDriveIntent(): DriveIntent | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(STORAGE_KEY);
    return parseIntent(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function clearDriveIntent(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nada que limpiar.
  }
}
