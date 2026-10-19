import { initializePaddle, type Environments, type Paddle } from '@paddle/paddle-js';

/**
 * Cliente de Paddle.js para el checkout overlay.
 *
 * El server crea la transacción (`createPaddleCheckout`) y devuelve su
 * `transactionId`; acá solo se inicializa Paddle.js y se abre el overlay para
 * esa transacción. Así el server sigue siendo la única fuente de verdad del
 * precio y la moneda, y el `custom_data` (tenant/plan) ya viaja en la
 * transacción que ve el webhook. No se exponen `pri_` al cliente.
 *
 * Ver `.agents/skills/paddle-checkout-web`. `successUrl` va ABSOLUTO: pasado a
 * `initializePaddle` una URL relativa se descarta con un `checkout.warning` y no
 * redirige; pasado a `Checkout.open` directamente tira.
 */
export const PADDLE_SUCCESS_PATH = '/billing?success=true';

let clientPromise: Promise<Paddle | null> | null = null;

// Customer de Paddle (ctm_...) del tenant firmado, para Paddle Retain. Debe ser
// el `paddle_customer_id` de Paddle, nunca el id interno ni el email: Retain lo
// usa para identificar al cliente en los flujos de retención/cancelación.
let paddleCustomerId: string | null = null;

/**
 * Setea el customer de Paddle antes de inicializar Paddle.js (`pwCustomer`).
 * Si el cliente ya estaba inicializado sin este id, se resetea la promesa para
 * que la siguiente llamada re-inicialice (el paquete aplica un `Update()` con
 * las nuevas opciones).
 */
export function setPaddleCustomer(id: string | null): void {
  if (id === paddleCustomerId) return;
  paddleCustomerId = id;
  if (clientPromise) clientPromise = null;
}

function getSuccessUrl(): string {
  return `${window.location.origin}${PADDLE_SUCCESS_PATH}`;
}

/** ¿Hay client token configurado? Sin él el overlay queda deshabilitado. */
export function isPaddleCheckoutConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN);
}

/**
 * Inicializa Paddle.js una sola vez por carga de página. El paquete no
 * re-inicializa: una segunda llamada sería un `Paddle.Update()` con las nuevas
 * opciones, así que se guarda la promesa y se reusa.
 *
 * Devuelve `null` si falta el client token o el entorno; en ese caso el caller
 * cae al redirect de `checkout.url` que devuelve el server.
 */
export function getPaddleClient(): Promise<Paddle | null> {
  if (clientPromise) return clientPromise;

  const token = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN;
  const environment = process.env.NEXT_PUBLIC_PADDLE_ENV as Environments | undefined;
  if (!token || !environment) {
    clientPromise = Promise.resolve(null);
    return clientPromise;
  }

  clientPromise = initializePaddle({
    token,
    environment,
    // Retain: identifica al cliente firmado con su `ctm_` de Paddle. Sin esto
    // los flujos de retención de Paddle no saben a quién ofrecerles.
    ...(paddleCustomerId ? { pwCustomer: { id: paddleCustomerId } } : {}),
    eventCallback: (event) => {
      if (event.type === 'checkout.warning') {
        // El checkout abrió pero Paddle descartó algún valor (p. ej. un
        // successUrl relativo). Se registra para detectarlo en desarrollo.
        console.warn('[Paddle]', event.detail);
      } else if (event.name && !event.data) {
        // checkout.error / checkout.payment.error: traen `name` y no `data`.
        console.error('[Paddle]', event.name, event.code, event.detail);
      }
    },
    checkout: {
      settings: { successUrl: getSuccessUrl() },
    },
  }).then((paddle) => paddle ?? null);

  return clientPromise;
}

/**
 * Abre el overlay para una transacción ya creada por el server. Devuelve
 * `false` cuando Paddle.js no está disponible (sin client token o falló la
 * carga) para que el caller pueda caer al `checkout.url` del server.
 */
export async function openPaddleCheckout(transactionId: string): Promise<boolean> {
  const paddle = await getPaddleClient();
  if (!paddle) return false;
  paddle.Checkout.open({
    transactionId,
    settings: { variant: 'one-page', successUrl: getSuccessUrl() },
  });
  return true;
}
