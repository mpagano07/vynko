/**
 * Redondeo comercial del precio de venta. Los valores están en pesos enteros;
 * `roundPriceCents` recibe el precio en centavos porque así se guarda en la DB.
 *
 * En Argentina es común ajustar precios por inflación y terminar con valores
 * como $1.487. Redondear a la decena/centena/millar facilita el vuelto en
 * efectivo sin cambiar el porcentaje de aumento.
 */
export const PRICE_ROUNDING_OPTIONS = [
  { value: 0, label: 'Sin redondeo' },
  { value: 10, label: 'A la decena' },
  { value: 100, label: 'Al centenar' },
  { value: 1000, label: 'Al millar' },
] as const;

export type PriceRounding = (typeof PRICE_ROUNDING_OPTIONS)[number]['value'];

export function isPriceRounding(value: unknown): value is PriceRounding {
  return (
    typeof value === 'number' &&
    PRICE_ROUNDING_OPTIONS.some((option) => option.value === value)
  );
}

export function roundPriceCents(cents: number, roundToPesos: PriceRounding): number {
  if (!Number.isFinite(cents)) return cents;
  if (roundToPesos <= 0) return Math.round(cents);

  const step = roundToPesos * 100;
  const rounded = Math.round(cents / step) * step;

  // Nunca dejar un precio en cero por redondear un producto barato al millar.
  return rounded > 0 ? rounded : Math.round(cents);
}
