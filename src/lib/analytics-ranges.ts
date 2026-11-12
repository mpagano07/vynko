/**
 * Rangos del panel de analytics. Vive en un módulo sin dependencias de servidor
 * para que la ruta y la página compartan las mismas opciones y validación.
 */
export const ANALYTICS_EVENT_RANGES = [
  { days: 7, label: '7 días' },
  { days: 30, label: '30 días' },
  { days: 90, label: '90 días' },
  { days: 0, label: 'Todo' },
] as const;

export type AnalyticsRangeDays = (typeof ANALYTICS_EVENT_RANGES)[number]['days'];

export function isAnalyticsRangeDays(value: number): value is AnalyticsRangeDays {
  return ANALYTICS_EVENT_RANGES.some((range) => range.days === value);
}

/** `0` significa todo el historial: no se manda filtro a la consulta. */
export function analyticsSince(
  days: AnalyticsRangeDays,
  now: number = Date.now()
): string | undefined {
  if (days <= 0) return undefined;
  return new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
}
