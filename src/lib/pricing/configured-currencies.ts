/**
 * Cookie con las monedas de Paddle configuradas.
 *
 * La setea el proxy en cada respuesta a partir de `PADDLE_PRICE_IDS` (env
 * server-only) para que el cliente -que no puede leer env- muestre el precio en
 * la MISMA moneda en la que el checkout va a cobrar. Ver
 * `getPaddleConfiguredCurrencies` y `usesLocalCurrency`.
 */
export const PADDLE_CURRENCIES_COOKIE = 'vynko_paddle_currencies';

/**
 * Monedas configuradas a partir del valor crudo de la cookie (coma-separado).
 *
 * Devuelve `null` si NO hay valor: el llamador decide el default. No se
 * interpreta "sin cookie" como "sin monedas", porque eso apagaria el precio
 * local en el primer render (antes de que el proxy haya seteado la cookie).
 */
export function parseConfiguredCurrencies(
  value: string | null | undefined
): ReadonlySet<string> | null {
  if (value === null || value === undefined) return null;
  const currencies = value
    .split(',')
    .map((currency) => currency.trim().toUpperCase())
    .filter(Boolean);
  return new Set(currencies);
}

/**
 * Lee la cookie de monedas configuradas del navegador.
 *
 * Solo tiene sentido en el cliente (en SSR no hay `document`): fuera del
 * navegador devuelve `null`, y el pricing usa su default.
 */
export function getConfiguredCurrenciesFromCookie(): ReadonlySet<string> | null {
  if (typeof document === 'undefined') return null;
  try {
    const match = document.cookie.match(
      new RegExp(`(?:^|; )${PADDLE_CURRENCIES_COOKIE}=([^;]*)`)
    );
    if (!match) return null;
    return parseConfiguredCurrencies(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}
