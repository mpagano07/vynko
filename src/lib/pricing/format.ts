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

export function formatPriceByCountry({
  amount,
  country,
  locale,
}: {
  amount: number
  country: CountryCode
  locale?: string
}): string {
  const currency = CURRENCY_MAP[country]
  const loc = locale ?? LOCALE_MAP[country]

  if (amount === 0) return 'A medida'

  return new Intl.NumberFormat(loc, {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}
