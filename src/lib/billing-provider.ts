import type { CountryCode } from '@/lib/pricing';
import { getCurrencyForCountry } from '@/lib/pricing';
import { getPaddlePriceId, isPaddleConfigured, type PaddlePlan } from '@/lib/paddle';
import { getPaddleConfiguredCurrencies } from '@/lib/paddle-price-ids';

export type BillingProvider = 'mercadopago' | 'paddle';

export function isPaddlePlan(plan: string): plan is PaddlePlan {
  return plan === 'starter' || plan === 'business';
}

/**
 * Devuelve `true` si el país puede pagar por Paddle para ese plan.
 *
 * Argentina siempre queda afuera (se cobra en ARS con MercadoPago). Para el
 * resto, `getCurrencyForCountry` resuelve la moneda entre las CONFIGURADAS: si la
 * moneda local no tiene `price_id`, cae a USD (que también se muestra en USD),
 * así el precio mostrado y el cobrado coinciden. Solo si ni USD está configurado
 * el país queda afuera.
 */
export function canUsePaddle(country: CountryCode, plan: string): boolean {
  if (country === 'AR') return false;
  if (!isPaddlePlan(plan)) return false;
  if (!isPaddleConfigured()) return false;
  const configured = new Set(getPaddleConfiguredCurrencies());
  return Boolean(getPaddlePriceId(getCurrencyForCountry(country, configured), plan));
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
