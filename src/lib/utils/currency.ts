export function formatARS(value: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Agrupa los miles de un input de monto mientras se tipea: "80000" -> "80.000".
 * Acepta coma o punto como separador decimal y descarta el resto.
 */
export function groupThousands(raw: string): string {
  if (!raw) return raw;
  const hasDecimal = raw.includes(',');
  const [intRaw = '', decRaw = ''] = hasDecimal ? raw.split(',') : [raw, ''];
  const grouped = intRaw.replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return hasDecimal ? `${grouped},${decRaw.replace(/\D/g, '')}` : grouped;
}

/**
 * Convierte un monto ya formateado a número: "80.000,50" -> 80000.5.
 * Devuelve 0 si no queda nada parseable.
 */
export function parseAmountInput(formatted: string): number {
  if (!formatted) return 0;
  const normalized = formatted.replace(/\./g, '').replace(',', '.');
  const value = Number(normalized);
  return Number.isFinite(value) ? value : 0;
}

/** Convierte un número a un string de input con separadores de miles. */
export function amountToInput(value: number): string {
  if (!value) return '';
  return groupThousands(String(value).replace('.', ','));
}
