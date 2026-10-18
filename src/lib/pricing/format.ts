import type { CountryCode } from './country'

const CURRENCY_MAP: Record<CountryCode, string> = {
  AR: 'ARS',
  BO: 'BOB',
  BR: 'BRL',
  CL: 'CLP',
  CO: 'COP',
  CR: 'CRC',
  CU: 'USD',
  DO: 'DOP',
  EC: 'USD',
  GT: 'GTQ',
  HN: 'HNL',
  MX: 'MXN',
  NI: 'NIO',
  PA: 'USD',
  PE: 'PEN',
  PY: 'PYG',
  SV: 'USD',
  UY: 'UYU',
  VE: 'VES',
  DEFAULT: 'USD',
}

const LOCALE_MAP: Record<CountryCode, string> = {
  AR: 'es-AR',
  BO: 'es-BO',
  BR: 'pt-BR',
  CL: 'es-CL',
  CO: 'es-CO',
  CR: 'es-CR',
  CU: 'es-EC',
  DO: 'es-DO',
  EC: 'es-EC',
  GT: 'es-GT',
  HN: 'es-HN',
  MX: 'es-MX',
  NI: 'es-NI',
  PA: 'es-PA',
  PE: 'es-PE',
  PY: 'es-PY',
  SV: 'es-SV',
  UY: 'es-UY',
  VE: 'es-VE',
  DEFAULT: 'en-US',
}

// Monedas de pago que acepta Paddle Billing (developer.paddle.com/concepts/sell/
// supported-currencies). Es la pasarela de todo LATAM menos Argentina (que cobra
// por MercadoPago en ARS). Es la lista de lo que Paddle acepta EN TEORIA; para
// saber si realmente podemos cobrar una moneda hay que mirar las configuradas en
// `PADDLE_PRICE_IDS` (ver `configuredCurrencies` mas abajo). Si la moneda local
// de un país no tiene precio configurado, ese país se muestra y se cobra en USD
// para no prometer un precio en una moneda que el checkout no va a usar.
const PADDLE_PAYMENT_CURRENCIES = new Set([
  'USD', 'GBP', 'EUR', 'ARS', 'AUD', 'BRL', 'CAD', 'CHF', 'CLP', 'CNY', 'COP',
  'CZK', 'DKK', 'HKD', 'HUF', 'ILS', 'INR', 'JPY', 'KRW', 'MXN', 'NOK', 'NZD',
  'PEN', 'PLN', 'RUB', 'SEK', 'SGD', 'THB', 'TRY', 'TWD', 'UAH', 'VND', 'ZAR',
])

/**
 * Monedas de Paddle realmente configuradas (con `price_id`), o `undefined` para
 * usar el default ("Paddle soporta la moneda").
 *
 * El server la pasa desde `getPaddleConfiguredCurrencies()` (env `PADDLE_PRICE_IDS`)
 * y el cliente desde la cookie que setea el proxy. Cuando no se pasa, se asume
 * la lista de Paddle soportadas: preserva el comportamiento previo solo para
 * callers que no participan del cobro.
 */
export type ConfiguredCurrencies = ReadonlySet<string> | null | undefined

/**
 * Moneda en la que realmente se cobra el plan de un país: ARS por MercadoPago en
 * Argentina, la moneda local si Paddle la TIENE CONFIGURADA, y USD como
 * fallback. Es la que hay que usar tanto para mostrar el precio como para elegir
 * el `price_id`, para que el monto mostrado y el cobrado nunca difieran.
 */
export function getCurrencyForCountry(
  country: CountryCode,
  configuredCurrencies?: ConfiguredCurrencies
): string {
  if (country === 'AR') return 'ARS'
  const configured = configuredCurrencies ?? PADDLE_PAYMENT_CURRENCIES
  const local = CURRENCY_MAP[country] ?? 'USD'
  return configured.has(local.toUpperCase()) ? local : 'USD'
}

/**
 * ¿El precio de este país se cobra en su moneda local? Argentina siempre (ARS vía
 * MercadoPago); el resto solo si Paddle tiene un `price_id` para esa moneda.
 * Cuando es `false` el precio se muestra en USD (`PRICES_BY_COUNTRY.DEFAULT`).
 */
export function usesLocalCurrency(
  country: CountryCode,
  configuredCurrencies?: ConfiguredCurrencies
): boolean {
  if (country === 'AR') return true
  const configured = configuredCurrencies ?? PADDLE_PAYMENT_CURRENCIES
  return configured.has((CURRENCY_MAP[country] ?? 'USD').toUpperCase())
}

export function formatPriceByCountry({
  amount,
  country,
  locale,
  configuredCurrencies,
}: {
  amount: number
  country: CountryCode
  locale?: string
  configuredCurrencies?: ConfiguredCurrencies
}): string {
  const currency = getCurrencyForCountry(country, configuredCurrencies)
  const loc = locale ?? LOCALE_MAP[country]

  if (amount === 0) return 'A medida'

  return new Intl.NumberFormat(loc, {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}
