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
// por MercadoPago en ARS). Si la moneda local de un país no está acá, no podemos
// cobrarla: ese país se muestra y se cobra en USD para no prometer un precio en
// una moneda que el checkout no va a usar.
const PADDLE_PAYMENT_CURRENCIES = new Set([
  'USD', 'GBP', 'EUR', 'ARS', 'AUD', 'BRL', 'CAD', 'CHF', 'CLP', 'CNY', 'COP',
  'CZK', 'DKK', 'HKD', 'HUF', 'ILS', 'INR', 'JPY', 'KRW', 'MXN', 'NOK', 'NZD',
  'PEN', 'PLN', 'RUB', 'SEK', 'SGD', 'THB', 'TRY', 'TWD', 'UAH', 'VND', 'ZAR',
])

/**
 * Moneda en la que realmente se cobra el plan de un país: ARS por MercadoPago en
 * Argentina, la moneda local si Paddle la soporta, y USD como fallback. Es la
 * que hay que usar tanto para mostrar el precio como para elegir el `price_id`.
 */
export function getCurrencyForCountry(country: CountryCode): string {
  if (country === 'AR') return 'ARS'
  const local = CURRENCY_MAP[country] ?? 'USD'
  return PADDLE_PAYMENT_CURRENCIES.has(local) ? local : 'USD'
}

/**
 * ¿El precio de este país se cobra en su moneda local? Argentina siempre (ARS vía
 * MercadoPago); el resto solo si Paddle soporta esa moneda. Cuando es `false` el
 * precio se muestra en USD (`PRICES_BY_COUNTRY.DEFAULT`).
 */
export function usesLocalCurrency(country: CountryCode): boolean {
  if (country === 'AR') return true
  return PADDLE_PAYMENT_CURRENCIES.has(CURRENCY_MAP[country] ?? 'USD')
}

export function formatPriceByCountry({
  amount,
  country,
  locale,
}: {
  amount: number
  country: CountryCode
  locale?: string
}): string {
  const currency = getCurrencyForCountry(country)
  const loc = locale ?? LOCALE_MAP[country]

  if (amount === 0) return 'A medida'

  return new Intl.NumberFormat(loc, {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}
