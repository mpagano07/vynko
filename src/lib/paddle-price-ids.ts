import { logger } from '@/lib/logger';

export type PaddlePlan = 'starter' | 'business';

export type PriceIds = Record<string, Partial<Record<PaddlePlan, string>>>;

/**
 * Precios por moneda de Paddle, configurados como JSON en `PADDLE_PRICE_IDS`.
 * Ejemplo:
 *   {"USD":{"starter":"pri_...","business":"pri_..."},"COP":{...}}
 *
 * Vive en su propio modulo (y NO en `paddle.ts`) porque `paddle.ts` importa
 * `crypto` de Node y no se puede bundlear en el Edge runtime: el proxy necesita
 * este parseo para saber que monedas estan configuradas y setear la cookie que
 * lee el cliente. Aca el parseo es isomorfo (solo `JSON` + `logger`).
 */
export function parsePriceIds(): PriceIds {
  const raw = process.env.PADDLE_PRICE_IDS;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as PriceIds;
  } catch (err) {
    logger.error('PADDLE_PRICE_IDS no es JSON válido, se ignora', { error: err });
  }
  return {};
}

/**
 * Monedas (en mayusculas) con al menos un plan con precio configurado en
 * `PADDLE_PRICE_IDS`.
 *
 * Es la lista de monedas en las que REALMENTE podemos cobrar, distinta de las
 * que Paddle acepta en teoria. El pricing la usa para decidir si un pais se
 * muestra y se cobra en su moneda local o en USD: una moneda que Paddle soporta
 * pero sin precio configurado se cae a USD, asi el precio MOSTRADO siempre
 * coincide con la moneda que el checkout va a COBRAR.
 *
 * El server la lee directo del env; el cliente la recibe por la cookie que setea
 * el proxy (ver `PADDLE_CURRENCIES_COOKIE` en `@/lib/pricing`).
 */
export function getPaddleConfiguredCurrencies(): string[] {
  const ids = parsePriceIds();
  return Object.keys(ids)
    .filter((currency) => {
      const plans = ids[currency];
      return (
        plans !== null &&
        typeof plans === 'object' &&
        Object.values(plans).some((id) => Boolean(id))
      );
    })
    .map((currency) => currency.toUpperCase());
}
