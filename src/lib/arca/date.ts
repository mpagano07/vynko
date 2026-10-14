/**
 * Helpers de fecha para ARCA.
 *
 * ARCA opera en hora de Argentina (UTC-3). Usar `Date.toISOString()` después de
 * las 21:00 locales devuelve el día siguiente en UTC, lo que fecha el
 * comprobante (y el QR) un día adelante. Todas las fechas fiscales se calculan
 * en la zona horaria de Argentina.
 */
const ARGENTINA_TIME_ZONE = 'America/Argentina/Buenos_Aires';

/** Formatea una fecha como `YYYY-MM-DD` en hora de Argentina. */
export function toArgentinaDate(value: Date | string = new Date()): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: ARGENTINA_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }

  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ARGENTINA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Formatea una fecha como `YYYYMMDD` en hora de Argentina (formato WSFE). */
export function toArgentinaDateCompact(value: Date | string = new Date()): string {
  return toArgentinaDate(value).replace(/-/g, '');
}
