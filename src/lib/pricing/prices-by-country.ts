import type { CountryCode } from './country'

export type PlanId = 'starter' | 'business' | 'enterprise'

export interface PriceSet {
  starter: number
  business: number
  enterprise: number
}

export const PRICES_BY_COUNTRY: Record<CountryCode, PriceSet> = {
  AR: { starter: 19900, business: 29900, enterprise: 0 },
  BO: { starter: 199, business: 299, enterprise: 0 },
  BR: { starter: 149, business: 249, enterprise: 0 },
  CL: { starter: 99000, business: 149000, enterprise: 0 },
  CO: { starter: 99000, business: 149000, enterprise: 0 },
  CR: { starter: 19990, business: 29990, enterprise: 0 },
  CU: { starter: 29, business: 49, enterprise: 0 },
  DO: { starter: 1799, business: 2699, enterprise: 0 },
  EC: { starter: 29, business: 49, enterprise: 0 },
  GT: { starter: 229, business: 349, enterprise: 0 },
  HN: { starter: 729, business: 1099, enterprise: 0 },
  MX: { starter: 899, business: 1499, enterprise: 0 },
  NI: { starter: 1049, business: 1549, enterprise: 0 },
  PA: { starter: 29, business: 49, enterprise: 0 },
  PE: { starter: 399, business: 599, enterprise: 0 },
  PY: { starter: 1990000, business: 2990000, enterprise: 0 },
  SV: { starter: 29, business: 49, enterprise: 0 },
  UY: { starter: 14990, business: 21990, enterprise: 0 },
  VE: { starter: 1299, business: 1999, enterprise: 0 },
  DEFAULT: { starter: 29, business: 49, enterprise: 0 },
}

export function getPriceForCountry(country: CountryCode, plan: PlanId): number {
  const set = PRICES_BY_COUNTRY[country] ?? PRICES_BY_COUNTRY.DEFAULT
  return set[plan]
}
