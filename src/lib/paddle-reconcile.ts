import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { getPaddleSubscription, type PaddleSubscription } from '@/lib/paddle';
import { processPaddleWebhook, type PaddleEvent } from '@/lib/paddle-webhook-service';

/**
 * Cuantos tenants comparar por corrida. Igual que MercadoPago: cada comparacion
 * es una llamada a la API de Paddle y la corrida tiene que ser acotada. Si
 * quedan pendientes, la siguiente pasada sigue desde donde quedo (`order by
 * updated_at`).
 */
const DEFAULT_LIMIT = 100;

export type PaddleReconcileOutcome = 'in_sync' | 'repaired' | 'unreachable';

export type PaddleReconcileReport = {
  checked: number;
  inSync: number;
  repaired: number;
  unreachable: number;
  /** Suscripciones que no se pudieron verificar, para reintentar en la proxima pasada. */
  deferred: string[];
  details: Array<{ tenantId: string; subscriptionId: string; outcome: PaddleReconcileOutcome }>;
};

type PaddleReconcileOptions = {
  limit?: number;
  /** Inyectable para tests: no se quiere llamar a Paddle en unit tests. */
  fetchSubscription?: typeof getPaddleSubscription;
  /** Inyectable para tests. */
  process?: typeof processPaddleWebhook;
};

/**
 * Estado de suscripcion en la base que corresponde a cada estado de Paddle.
 *
 * `trialing` mapea a `active` porque Paddle cobra recien al terminar la prueba y
 * el gate de la app solo distingue activo / vencido. Un estado desconocido
 * devuelve `null`: no se adivina.
 */
function expectedFromPaddleStatus(status: string): 'active' | 'canceled' | 'past_due' | null {
  switch (status) {
    case 'active':
    case 'trialing':
      return 'active';
    case 'canceled':
      return 'canceled';
    case 'past_due':
    case 'paused':
      return 'past_due';
    default:
      return null;
  }
}

function emptyReport(): PaddleReconcileReport {
  return { checked: 0, inSync: 0, repaired: 0, unreachable: 0, deferred: [], details: [] };
}

/**
 * Compara la suscripcion de Paddle contra la base y repara las divergencias.
 *
 * Por que existe: igual que en MercadoPago, el webhook es la unica via de
 * sincronizacion y un webhook se pierde. Si el pago falla y el evento no llega,
 * el tenant sigue con acceso; si la cancelacion se pierde, sigue pagando.
 *
 * La reparacion REUTILIZA `processPaddleWebhook` con un evento sintetico, en vez
 * de reimplementar las transiciones: el camino de reconciliacion ejecuta el
 * mismo compare-and-set que la notificacion, asi que no hay una segunda version
 * de la regla de negocio. El evento va SIN `event_id` para que no ensucie la
 * bitacora `webhook_events` (que deduplica por entrega) ni entre en el dedupe
 * del route.
 *
 * Solo se compara el ESTADO, no el fin de periodo. Si se comparara el periodo,
 * una transaccion de cambio de plan todavia pendiente (con la suscripcion vieja
 * aun activa y `paddle_pending_transaction_id` seteado) dispararia la
 * reparacion sobre la suscripcion vieja y aplicaria el plan destino antes de
 * que Paddle cobre la nueva.
 */
export async function reconcilePaddleSubscriptions(
  options: PaddleReconcileOptions = {}
): Promise<PaddleReconcileReport> {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const fetchSubscription = options.fetchSubscription ?? getPaddleSubscription;
  const process = options.process ?? processPaddleWebhook;

  const { data: tenants, error } = await supabaseAdmin
    .from('tenants')
    .select('id, subscription_status, paddle_subscription_id')
    .not('paddle_subscription_id', 'is', null)
    .order('updated_at', { ascending: true })
    .limit(limit);

  if (error) return emptyReport();

  const report = emptyReport();

  for (const tenant of tenants ?? []) {
    const subscriptionId = tenant.paddle_subscription_id as string;
    const tenantId = tenant.id as string;

    // `checked` cuenta todo tenant examinado, incluidos los que no se pudieron
    // resolver, para que inSync + repaired + unreachable cuadre con el total.
    report.checked += 1;

    let subscription: PaddleSubscription;
    try {
      subscription = await fetchSubscription(subscriptionId);
    } catch {
      // Fallo transitorio de la API de Paddle: no se toca nada y se reintenta en
      // la proxima pasada. Marcarla cancelada por no poder consultar seria el
      // peor resultado posible.
      report.unreachable += 1;
      report.deferred.push(subscriptionId);
      report.details.push({ tenantId, subscriptionId, outcome: 'unreachable' });
      continue;
    }

    const expected = expectedFromPaddleStatus(subscription.status);

    if (expected === null) {
      // Estado que no sabemos mapear: se deja como esta.
      report.inSync += 1;
      report.details.push({ tenantId, subscriptionId, outcome: 'in_sync' });
      continue;
    }

    if (tenant.subscription_status === expected) {
      report.inSync += 1;
      report.details.push({ tenantId, subscriptionId, outcome: 'in_sync' });
      continue;
    }

    // Divergencia: se reaplica el mismo camino que el webhook.
    const event: PaddleEvent = {
      event_type: 'subscription.updated',
      data: {
        id: subscriptionId,
        status: subscription.status,
        customer_id: subscription.customerId,
        current_billing_period: { ends_at: subscription.currentBillingPeriodEnd },
        custom_data: subscription.customData,
      },
    };

    const result = await process(event);

    if (result.ok) {
      report.repaired += 1;
      report.details.push({ tenantId, subscriptionId, outcome: 'repaired' });
    } else {
      report.unreachable += 1;
      report.deferred.push(subscriptionId);
      report.details.push({ tenantId, subscriptionId, outcome: 'unreachable' });
    }
  }

  return report;
}
