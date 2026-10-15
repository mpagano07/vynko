import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { getPaddleSubscription } from '@/lib/paddle';
import { trackEvent } from '@/lib/track-event';
import { recordWebhookEvent, type WebhookOutcome } from '@/lib/mercadopago-webhook-log';
import { scheduleAfterBackground } from '@/lib/after-background';
import { resolveOwnerBranchIds, resolveOwnerUserId } from '@/lib/mercadopago-webhook-service';
import { logger } from '@/lib/logger';

export type PaddleWebhookResult =
  | { ok: true; data: { received: true } }
  | { ok: false; error: string; status: number };

type PaddlePlan = 'starter' | 'business';

interface PaddleEventData {
  id?: string;
  status?: string;
  customer_id?: string | null;
  subscription_id?: string | null;
  current_billing_period?: { ends_at?: string | null } | null;
  custom_data?: Record<string, unknown> | null;
}

export interface PaddleEvent {
  event_id?: string;
  event_type?: string;
  data?: PaddleEventData;
}

function planFromCustom(customData: Record<string, unknown> | null | undefined): PaddlePlan | null {
  const plan = customData?.plan;
  return plan === 'starter' || plan === 'business' ? plan : null;
}

function tenantIdFromCustom(customData: Record<string, unknown> | null | undefined): string | null {
  const tenantId = customData?.tenant_id;
  return typeof tenantId === 'string' && tenantId.length > 0 ? tenantId : null;
}

/**
 * Procesa un evento de Paddle Billing.
 *
 * Paddle entrega at-least-once y reintenta cualquier respuesta que no sea 2xx
 * (hasta ~3 días). La deduplicación vive en el route (`event_id`), igual que en
 * MercadoPago con `x-request-id`; acá la escritura se hace con compare-and-set
 * sobre `subscription_status` para que dos entregas simultáneas no dupliquen la
 * arista (y el `subscription_started` del embudo).
 *
 * El tenant y el plan salen de `custom_data`, que Paddle copia de la transacción
 * a la suscripción que crea; si no está (o el evento tardío no lo trae), se
 * resuelve por `paddle_subscription_id`.
 */
export async function processPaddleWebhook(event: PaddleEvent): Promise<PaddleWebhookResult> {
  const startedAt = Date.now();
  const eventId = event.event_id;
  const eventType = event.event_type ?? 'unknown';

  let outcome: WebhookOutcome = 'ignored';
  let providerStatus: string | null = null;
  let resolvedTenantId: string | null = null;
  let resolvedUserId: string | null = null;

  const logOutcome = (finalOutcome: WebhookOutcome, error?: string) => {
    if (!eventId) return;
    scheduleAfterBackground(() =>
      recordWebhookEvent({
        provider: 'paddle',
        providerEventId: eventId,
        deliveryId: eventId,
        topic: eventType,
        mpStatus: providerStatus,
        outcome: finalOutcome,
        tenantId: resolvedTenantId,
        userId: resolvedUserId,
        error: error ?? null,
        durationMs: Date.now() - startedAt,
      })
    );
  };

  try {
    const data = event.data ?? {};

    let subscriptionId: string | null = null;
    let status: string | null = null;
    let customData = data.custom_data ?? null;
    let customerId = data.customer_id ?? null;
    let periodEnd = data.current_billing_period?.ends_at ?? null;
    let plan = planFromCustom(customData);

    if (eventType.startsWith('subscription.')) {
      subscriptionId = data.id ?? null;
      status = data.status ?? null;
    } else if (eventType === 'transaction.completed') {
      // La transacción no trae el estado ni el período de la suscripción: se
      // relee la suscripción que Paddle creó a partir de ella.
      subscriptionId = data.subscription_id ?? null;
      if (!subscriptionId) {
        logOutcome('ignored');
        return { ok: true, data: { received: true } };
      }
      const sub = await getPaddleSubscription(subscriptionId);
      status = sub.status;
      customerId = sub.customerId ?? customerId;
      periodEnd = sub.currentBillingPeriodEnd ?? periodEnd;
      customData = sub.customData ?? customData;
      plan = planFromCustom(customData) ?? plan;
    } else {
      logOutcome('ignored');
      return { ok: true, data: { received: true } };
    }

    providerStatus = status;

    if (!subscriptionId) {
      logOutcome('error', 'Missing subscription id');
      return { ok: false, error: 'Missing subscription id', status: 400 };
    }

    let tenantId = tenantIdFromCustom(customData);
    if (!tenantId) {
      const { data: row } = await supabaseAdmin
        .from('tenants')
        .select('id')
        .eq('paddle_subscription_id', subscriptionId)
        .maybeSingle();
      tenantId = row?.id ?? null;
    }
    if (!tenantId) {
      logOutcome('error', 'No tenant');
      return { ok: false, error: 'No tenant', status: 400 };
    }
    resolvedTenantId = tenantId;

    const ownerBranchIds = await resolveOwnerBranchIds(tenantId, [tenantId]);
    const ownerUserId = await resolveOwnerUserId(tenantId);
    resolvedUserId = ownerUserId;

    const { data: tenantRow } = await supabaseAdmin
      .from('tenants')
      .select(
        'subscription_plan, paddle_subscription_id, paddle_pending_transaction_id, paddle_pending_plan'
      )
      .eq('id', tenantId)
      .maybeSingle();

    const currentSubId = tenantRow?.paddle_subscription_id ?? null;
    const pendingTx = tenantRow?.paddle_pending_transaction_id ?? null;
    const pendingPlan = tenantRow?.paddle_pending_plan ?? null;
    const hasPending = Boolean(pendingTx);

    if (status === 'active' || status === 'trialing') {
      // Ignora eventos de una suscripción que ya no es la vigente, salvo que
      // haya un cambio de plan en curso (que crea una suscripción nueva).
      if (currentSubId && currentSubId !== subscriptionId && !hasPending) {
        logOutcome('ignored', 'Suscripción que ya no es la vigente');
        return { ok: true, data: { received: true } };
      }

      const effectivePlan = pendingPlan ?? plan;
      const transitionData: Record<string, unknown> = {
        subscription_status: 'active',
        billing_provider: 'paddle',
        paddle_subscription_id: subscriptionId,
      };
      if (effectivePlan) transitionData.subscription_plan = effectivePlan;
      if (customerId) transitionData.paddle_customer_id = customerId;

      const { data: transitionedRows, error: transitionError } = await supabaseAdmin
        .from('tenants')
        .update(transitionData)
        .in('id', ownerBranchIds)
        .neq('subscription_status', 'active')
        .select('id');
      if (transitionError) throw transitionError;
      const transitioned = !Array.isArray(transitionedRows) || transitionedRows.length > 0;

      // Nivel: el período se refresca en cada entrega (renovación incluida),
      // aunque no haya cambio de estado.
      const periodData: Record<string, unknown> = {
        paddle_subscription_id: subscriptionId,
        billing_provider: 'paddle',
      };
      if (periodEnd) periodData.subscription_current_period_end = periodEnd;
      if (customerId) periodData.paddle_customer_id = customerId;
      const { error: periodError } = await supabaseAdmin
        .from('tenants')
        .update(periodData)
        .in('id', ownerBranchIds);
      if (periodError) throw periodError;

      // Si el evento corresponde a un cambio de plan pendiente, se aplica el
      // plan destino, se limpia el pendiente y se cancela la suscripción vieja.
      let planApplied = false;
      if (hasPending && (pendingPlan || plan)) {
        const { error: pendingError } = await supabaseAdmin
          .from('tenants')
          .update({
            subscription_plan: pendingPlan ?? plan,
            paddle_pending_transaction_id: null,
            paddle_pending_plan: null,
          })
          .in('id', ownerBranchIds);
        if (pendingError) throw pendingError;

        if (currentSubId && currentSubId !== subscriptionId) {
          try {
            const { cancelPaddleSubscription } = await import('@/lib/paddle');
            await cancelPaddleSubscription(currentSubId, false);
          } catch (err) {
            logger.error('Error cancelling old Paddle subscription after plan change:', { error: err });
          }
        }
        planApplied = true;
      }

      if ((transitioned || planApplied) && ownerUserId) {
        await trackEvent({
          type: 'subscription_started',
          userId: ownerUserId,
          tenantId,
          metadata: { plan: effectivePlan ?? 'business', subscription_id: subscriptionId, provider: 'paddle' },
        });
      }

      outcome = transitioned || planApplied ? 'processed' : 'duplicate';
    } else if (status === 'canceled') {
      const currentPlan = tenantRow?.subscription_plan;
      const planToSet = currentPlan === 'business' || currentPlan === 'enterprise' ? 'free' : currentPlan ?? 'free';

      if (currentSubId && currentSubId !== subscriptionId) {
        logOutcome('ignored', 'Cancelación de una suscripción que ya no es la vigente');
        return { ok: true, data: { received: true } };
      }

      const { data: cancelledRows, error: cancelError } = await supabaseAdmin
        .from('tenants')
        .update({
          subscription_status: 'canceled',
          subscription_plan: planToSet,
          paddle_subscription_id: null,
        })
        .in('id', ownerBranchIds)
        .neq('subscription_status', 'canceled')
        .select('id');
      if (cancelError) throw cancelError;
      const transitioned = !Array.isArray(cancelledRows) || cancelledRows.length > 0;

      if (transitioned && ownerUserId) {
        await trackEvent({
          type: 'subscription_cancelled',
          userId: ownerUserId,
          tenantId,
          metadata: { plan: currentPlan ?? 'unknown', subscription_id: subscriptionId, provider: 'paddle', source: 'webhook' },
        });
      }

      outcome = transitioned ? 'processed' : 'duplicate';
    } else if (status === 'past_due' || status === 'paused') {
      // Pago fallido o suscripción pausada: se marca `past_due` para bloquear el
      // acceso (mismo criterio que MercadoPago con `paused`).
      const { error: pausedError } = await supabaseAdmin
        .from('tenants')
        .update({ subscription_status: 'past_due' })
        .in('id', ownerBranchIds)
        .neq('subscription_status', 'past_due');
      if (pausedError) throw pausedError;
      outcome = 'processed';
    } else {
      outcome = 'ignored';
    }

    logOutcome(outcome);
  } catch (err) {
    logger.error('Paddle webhook error:', { error: err });
    logOutcome('error', err instanceof Error ? err.message : String(err));
    return { ok: false, error: 'Webhook processing failed', status: 500 };
  }

  return { ok: true, data: { received: true } };
}
