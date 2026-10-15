import crypto from 'crypto';
import { logger } from '@/lib/logger';

/**
 * Cliente mínimo de Paddle Billing.
 *
 * Paddle actúa como Merchant of Record (MoR) para los países que no cobramos
 * con MercadoPago: maneja el impuesto local y cobra en la moneda del comprador
 * (creamos un precio por moneda y elegimos el `price_id` según el país).
 *
 * Se implementa con `fetch` + `crypto` (igual que `mercadopago.ts`) en vez del
 * SDK oficial `@paddle/paddle-node-sdk`: son cuatro llamadas y así no se suma
 * una dependencia de runtime por el camino crítico de facturación.
 */

const SANDBOX_BASE = 'https://sandbox-api.paddle.com';
const PRODUCTION_BASE = 'https://api.paddle.com';

export type PaddlePlan = 'starter' | 'business';

type PriceIds = Record<string, Partial<Record<PaddlePlan, string>>>;

function getApiBase(): string {
  const env = (process.env.PADDLE_ENVIRONMENT || 'sandbox').toLowerCase();
  return env === 'production' ? PRODUCTION_BASE : SANDBOX_BASE;
}

function getApiKey(): string {
  const key = process.env.PADDLE_API_KEY;
  if (!key) {
    throw new Error(
      'Paddle API key is required. Ensure PADDLE_API_KEY is set in your environment variables.'
    );
  }
  return key;
}

/**
 * ¿Está Paddle listo para iniciar un checkout? Sin API key el cobro no se puede
 * crear, así que el router de billing cae a MercadoPago.
 */
export function isPaddleConfigured(): boolean {
  return Boolean(process.env.PADDLE_API_KEY);
}

/**
 * Precios por moneda, configurados como JSON en `PADDLE_PRICE_IDS`. Ejemplo:
 *   {"USD":{"starter":"pri_...","business":"pri_..."},"COP":{...}}
 *
 * Se mantiene en una sola variable en vez de una por moneda+plan (hoy son 15
 * monedas) para que sumar un precio no implique tocar el panel de env vars de
 * Vercel con un nombre nuevo.
 */
function parsePriceIds(): PriceIds {
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
 * `price_id` de Paddle para una moneda y plan, o `null` si no está configurado.
 * El router de billing usa `null` para decidir que ese país todavía no puede
 * pagar por Paddle.
 */
export function getPaddlePriceId(currency: string, plan: PaddlePlan): string | null {
  const ids = parsePriceIds();
  const entry = ids[currency?.toUpperCase()] ?? ids.USD;
  return entry?.[plan] ?? null;
}

type PaddleErrorBody = { error?: { detail?: string; code?: string } };

async function paddleRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });

  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : null;

  if (!res.ok) {
    const detail = (body as PaddleErrorBody | null)?.error?.detail;
    throw new Error(`Paddle API ${res.status}: ${detail || res.statusText}`);
  }

  return body as T;
}

export interface PaddleCheckout {
  transactionId: string;
  url: string;
}

/**
 * Crea una transacción auto-cobrada y devuelve la URL del checkout hospedado.
 *
 * `custom_data` viaja con la transacción y Paddle la copia a la suscripción que
 * crea, así que el webhook puede resolver el tenant y el plan sin guardar un
 * mapeo adicional. El `checkout.url` (dominio aprobado) es opcional: sin él
 * Paddle usa el "default payment URL" de la cuenta.
 */
export async function createPaddleCheckout({
  priceId,
  tenantId,
  plan,
  customerId,
  checkoutUrl,
}: {
  priceId: string;
  tenantId: string;
  plan: PaddlePlan;
  customerId?: string | null;
  checkoutUrl?: string | null;
}): Promise<PaddleCheckout> {
  const body: Record<string, unknown> = {
    items: [{ price_id: priceId, quantity: 1 }],
    custom_data: { tenant_id: tenantId, plan },
  };
  if (customerId) body.customer_id = customerId;
  if (checkoutUrl) body.checkout = { url: checkoutUrl };

  const res = await paddleRequest<{
    data?: { id?: string; checkout?: { url?: string | null } | null };
  }>('/transactions', { method: 'POST', body: JSON.stringify(body) });

  const transactionId = res.data?.id;
  const url = res.data?.checkout?.url;
  if (!transactionId || !url) {
    throw new Error('Paddle no devolvió una URL de checkout');
  }
  return { transactionId, url };
}

export interface PaddleSubscription {
  id: string;
  status: 'active' | 'canceled' | 'past_due' | 'paused' | 'trialing';
  customerId: string | null;
  currentBillingPeriodEnd: string | null;
  customData: Record<string, unknown> | null;
}

type PaddleSubscriptionResponse = {
  data?: {
    id?: string;
    status?: PaddleSubscription['status'];
    customer_id?: string | null;
    current_billing_period?: { ends_at?: string | null } | null;
    custom_data?: Record<string, unknown> | null;
  };
};

function mapSubscription(data: PaddleSubscriptionResponse['data']): PaddleSubscription {
  if (!data?.id || !data.status) {
    throw new Error('Paddle devolvió una suscripción inválida');
  }
  return {
    id: data.id,
    status: data.status,
    customerId: data.customer_id ?? null,
    currentBillingPeriodEnd: data.current_billing_period?.ends_at ?? null,
    customData: data.custom_data ?? null,
  };
}

export async function getPaddleSubscription(subscriptionId: string): Promise<PaddleSubscription> {
  const res = await paddleRequest<PaddleSubscriptionResponse>(`/subscriptions/${subscriptionId}`);
  return mapSubscription(res.data);
}

/**
 * Cancela una suscripción. Por defecto Paddle la agenda para el fin del período
 * vigente (el usuario mantiene el acceso hasta que vence); con `immediate` corta
 * el cobro y el acceso en el acto.
 */
export async function cancelPaddleSubscription(
  subscriptionId: string,
  immediate = false
): Promise<PaddleSubscription> {
  const res = await paddleRequest<PaddleSubscriptionResponse>(
    `/subscriptions/${subscriptionId}/cancel`,
    {
      method: 'POST',
      body: JSON.stringify({ effective_from: immediate ? 'immediately' : 'next_billing_period' }),
    }
  );
  return mapSubscription(res.data);
}

const MAX_CLOCK_SKEW_SECONDS = 5 * 60;

/**
 * Verifica la firma `Paddle-Signature` (`ts=<unix>;h1=<hex>`): HMAC-SHA256 de
 * `ts:rawBody` con el secreto del notification destination. Durante una rotación
 * pueden llegar varios `h1`; alcanza con que uno coincida.
 */
export function verifyPaddleSignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.PADDLE_WEBHOOK_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      logger.error('PADDLE_WEBHOOK_SECRET is not set. Rejecting webhook.');
      return false;
    }
    logger.warn('PADDLE_WEBHOOK_SECRET is not set. Skipping signature verification in dev mode');
    return true;
  }

  if (!signatureHeader) return false;

  let ts = '';
  const hashes: string[] = [];
  for (const part of signatureHeader.split(';')) {
    const [key, val] = part.trim().split('=');
    if (key === 'ts') ts = val;
    if (key === 'h1' && val) hashes.push(val);
  }

  if (!ts || hashes.length === 0) return false;

  const tsNumber = Number(ts);
  if (!Number.isFinite(tsNumber)) return false;
  if (Math.abs(Date.now() / 1000 - tsNumber) > MAX_CLOCK_SKEW_SECONDS) return false;

  const expected = crypto.createHmac('sha256', secret).update(`${ts}:${rawBody}`).digest();

  try {
    return hashes.some((h) => {
      const received = Buffer.from(h, 'hex');
      return received.length === expected.length && crypto.timingSafeEqual(expected, received);
    });
  } catch (err) {
    logger.error('Error verifying Paddle signature:', { error: err });
    return false;
  }
}
