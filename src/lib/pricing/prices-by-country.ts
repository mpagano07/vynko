import { getEffectivePrice } from '@/lib/plans'
import { usesLocalCurrency, type ConfiguredCurrencies } from './format'
import type { CountryCode } from './country'

export type PlanId = 'starter' | 'business' | 'enterprise'

export interface PriceSet {
  starter: number
  business: number
  enterprise: number
}

// Precios pensados para equivaler a ~$15-19 USD (starter) / ~$21-29 USD (business)
// según el tipo de cambio aproximado de cada moneda, con un leve uplift
// psicológico para mercados con mayor poder adquisitivo.
export const PRICES_BY_COUNTRY: Record<CountryCode, PriceSet> = {
  AR: { starter: 19900, business: 29900, enterprise: 0 },
  BO: { starter: 119, business: 179, enterprise: 0 },
  BR: { starter: 89, business: 139, enterprise: 0 },
  CL: { starter: 15990, business: 23990, enterprise: 0 },
  CO: { starter: 69900, business: 109000, enterprise: 0 },
  CR: { starter: 8990, business: 13990, enterprise: 0 },
  CU: { starter: 17, business: 25, enterprise: 0 },
  DO: { starter: 999, business: 1499, enterprise: 0 },
  EC: { starter: 17, business: 25, enterprise: 0 },
  GT: { starter: 139, business: 199, enterprise: 0 },
  HN: { starter: 429, business: 659, enterprise: 0 },
  MX: { starter: 299, business: 449, enterprise: 0 },
  NI: { starter: 619, business: 959, enterprise: 0 },
  PA: { starter: 17, business: 25, enterprise: 0 },
  PE: { starter: 65, business: 99, enterprise: 0 },
  PY: { starter: 129000, business: 199000, enterprise: 0 },
  SV: { starter: 17, business: 25, enterprise: 0 },
  UY: { starter: 699, business: 1099, enterprise: 0 },
  VE: { starter: 179, business: 279, enterprise: 0 },
  DEFAULT: { starter: 17, business: 25, enterprise: 0 },
}

/**
 * Precio de un plan para un país.
 *
 * Si la moneda local no se puede cobrar (Paddle no tiene un `price_id` para ella),
 * devuelve el precio USD de `DEFAULT`: es el monto que efectivamente cobra el
 * checkout, así que mostrar el valor en moneda local sería inconsistente. Ver
 * `usesLocalCurrency`.
 */
export function getPriceForCountry(
  country: CountryCode,
  plan: PlanId,
  configuredCurrencies?: ConfiguredCurrencies
): number {
  const set = usesLocalCurrency(country, configuredCurrencies)
    ? PRICES_BY_COUNTRY[country] ?? PRICES_BY_COUNTRY.DEFAULT
    : PRICES_BY_COUNTRY.DEFAULT
  return set[plan]
}

/**
 * Precio a mostrar para un país.
 *
 * En Argentina el precio vive en `plans.ts` y pasa por `getEffectivePrice`,
 * que aplica las promos/descuentos en pesos. Fuera de Argentina se muestra el
 * precio de referencia en moneda local de `PRICES_BY_COUNTRY`: ese monto es el
 * que se cobra a través de la pasarela del país, así que las promos en ARS no
 * aplican. Sin este helper las landings formateaban el monto en ARS con el
 * símbolo local (29.900 COP en vez de 109.000 COP).
 */
export function getDisplayPrice(
  country: CountryCode,
  plan: PlanId,
  configuredCurrencies?: ConfiguredCurrencies
): number {
  if (country === 'AR') {
    const ar = getEffectivePrice(plan)
    return ar > 0 ? ar : getPriceForCountry(country, plan, configuredCurrencies)
  }
  return getPriceForCountry(country, plan, configuredCurrencies)
}
