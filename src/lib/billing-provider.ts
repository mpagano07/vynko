import type { CountryCode } from '@/lib/pricing';
import { getCurrencyForCountry } from '@/lib/pricing';
import { getPaddlePriceId, isPaddleConfigured, type PaddlePlan } from '@/lib/paddle';

export type BillingProvider = 'mercadopago' | 'paddle';

export function isPaddlePlan(plan: string): plan is PaddlePlan {
  return plan === 'starter' || plan === 'business';
}

/**
 * Devuelve `true` si el país puede pagar por Paddle para ese plan.
 *
 * Argentina siempre queda afuera (se cobra en ARS con MercadoPago) y los países
 * sin un `price_id` de Paddle configurado para su moneda también, para que el
 * router caiga a MercadoPago en vez de fallar el checkout.
 */
export function canUsePaddle(country: CountryCode, plan: string): boolean {
  if (country === 'AR') return false;
  if (!isPaddlePlan(plan)) return false;
  if (!isPaddleConfigured()) return false;
  return Boolean(getPaddlePriceId(getCurrencyForCountry(country), plan));
}

/**
 * Pasarela con la que se cobra un checkout NUEVO.
 *
 * Si el owner ya tiene una suscripción con una pasarela, se mantiene esa: no se
 * puede tener MercadoPago y Paddle cobrando la misma cuenta a la vez. Recién
 * para una cuenta sin pagos previos se elige por país.
 */
export function resolveBillingProvider(
  country: CountryCode,
  plan: string,
  existingProvider: BillingProvider | null
): BillingProvider {
  if (existingProvider === 'paddle' || existingProvider === 'mercadopago') {
    return existingProvider;
  }
  return canUsePaddle(country, plan) ? 'paddle' : 'mercadopago';
}

export function asBillingProvider(value: unknown): BillingProvider | null {
  return value === 'paddle' || value === 'mercadopago' ? value : null;
}
