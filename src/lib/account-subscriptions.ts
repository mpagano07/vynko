import { supabaseAdmin } from '@/lib/supabaseAdmin';
import {
  cancelPaddleSubscription,
  cancelPaddleTransaction,
  getPaddleSubscription,
  getPaddleTransaction,
  type PaddleTransaction,
} from '@/lib/paddle';
import {
  cancelPreApproval,
  getPreApprovalById,
} from '@/lib/mercadopago';
import { trackEvent } from '@/lib/track-event';
import { logger } from '@/lib/logger';

interface TenantBillingRow {
  id: string;
  billing_provider: string | null;
  paddle_subscription_id: string | null;
  paddle_pending_transaction_id: string | null;
  mercadopago_preapproval_id: string | null;
  mercadopago_pending_preapproval_id: string | null;
  subscription_plan: string | null;
  subscription_status: string | null;
}

interface BillingReference {
  tenantId: string;
  plan: string | null;
}

export interface AccountSubscriptionCancellation {
  canceledPaddleSubscriptions: number;
  canceledMercadoPagoPreapprovals: number;
  canceledPaddleTransactions: number;
}

export type AccountSubscriptionCancellationResult =
  | { ok: true; data: AccountSubscriptionCancellation }
  | { ok: false; error: string; status: number };

function remember(
  refs: Map<string, BillingReference>,
  id: string | null,
  row: TenantBillingRow
): void {
  if (!id) return;
  if (refs.has(id)) return;
  refs.set(id, { tenantId: row.id, plan: row.subscription_plan });
}

/**
 * Cancela todo lo que pueda generar un cobro futuro antes de borrar la cuenta.
 *
 * Es la parte que no puede fallar en silencio: si se borra la cuenta con una
 * suscripción viva, el usuario deja de poder entrar pero la tarjeta sigue
 * cobrando. Por eso, si Paddle o MercadoPago rechazan la cancelación, se aborta
 * el borrado y se le pide al usuario reintentar.
 *
 * Las transacciones de checkout pendientes de Paddle se cancelan best-effort:
 * una transacción sin pagar no cobra sola y Paddle no permite cancelar las que
 * ya generaron una suscripción. Esa suscripción es la que sí se cancela arriba.
 */
export async function cancelAccountSubscriptions(
  userId: string,
  tenantIds: string[]
): Promise<AccountSubscriptionCancellationResult> {
  if (tenantIds.length === 0) {
    return {
      ok: true,
      data: {
        canceledPaddleSubscriptions: 0,
        canceledMercadoPagoPreapprovals: 0,
        canceledPaddleTransactions: 0,
      },
    };
  }

  const { data, error } = await supabaseAdmin
    .from('tenants')
    .select(
      'id, billing_provider, paddle_subscription_id, paddle_pending_transaction_id, mercadopago_preapproval_id, mercadopago_pending_preapproval_id, subscription_plan, subscription_status'
    )
    .in('id', tenantIds);

  if (error) {
    logger.error('DB error reading subscriptions before deleting account:', { error });
    return { ok: false, error: 'No se pudo leer el estado de la suscripción.', status: 500 };
  }

  const rows = (data ?? []) as TenantBillingRow[];
  const paddleSubscriptionIds = new Set<string>();
  const paddleTransactionIds = new Set<string>();
  const mercadoPagoIds = new Set<string>();
  const currentMercadoPagoIds = new Set<string>();
  const refs = new Map<string, BillingReference>();

  for (const row of rows) {
    remember(refs, row.paddle_subscription_id, row);
    remember(refs, row.paddle_pending_transaction_id, row);
    remember(refs, row.mercadopago_preapproval_id, row);
    remember(refs, row.mercadopago_pending_preapproval_id, row);

    if (row.paddle_subscription_id) paddleSubscriptionIds.add(row.paddle_subscription_id);
    if (row.paddle_pending_transaction_id) paddleTransactionIds.add(row.paddle_pending_transaction_id);
    if (row.mercadopago_preapproval_id) {
      mercadoPagoIds.add(row.mercadopago_preapproval_id);
      currentMercadoPagoIds.add(row.mercadopago_preapproval_id);
    }
    if (row.mercadopago_pending_preapproval_id) {
      mercadoPagoIds.add(row.mercadopago_pending_preapproval_id);
    }
  }

  // Un checkout de Paddle pudo completarse justo antes de borrar la cuenta y
  // el webhook todavía no llegó. Se consulta la transacción: si ya creó una
  // suscripción, se agrega a la lista para cancelarla igual.
  const pendingPaddleTransactions: PaddleTransaction[] = [];
  for (const transactionId of paddleTransactionIds) {
    try {
      const transaction = await getPaddleTransaction(transactionId);
      pendingPaddleTransactions.push(transaction);
      if (
        transaction.subscriptionId &&
        !paddleSubscriptionIds.has(transaction.subscriptionId)
      ) {
        paddleSubscriptionIds.add(transaction.subscriptionId);
        const ref = refs.get(transactionId);
        if (ref) refs.set(transaction.subscriptionId, ref);
      }
    } catch (err) {
      logger.warn('No se pudo leer una transacción pendiente de Paddle:', {
        error: err,
        transactionId,
      });
    }
  }

  const hasActiveSubscriptionId =
    paddleSubscriptionIds.size > 0 || currentMercadoPagoIds.size > 0;
  const hasBillingArtifacts =
    hasActiveSubscriptionId || paddleTransactionIds.size > 0 || mercadoPagoIds.size > 0;

  if (!hasBillingArtifacts) {
    return {
      ok: true,
      data: {
        canceledPaddleSubscriptions: 0,
        canceledMercadoPagoPreapprovals: 0,
        canceledPaddleTransactions: 0,
      },
    };
  }

  let canceledPaddleSubscriptions = 0;
  let canceledMercadoPagoPreapprovals = 0;
  let canceledPaddleTransactions = 0;

  for (const subscriptionId of paddleSubscriptionIds) {
    try {
      const subscription = await getPaddleSubscription(subscriptionId);
      if (subscription.status === 'canceled') continue;

      await cancelPaddleSubscription(subscriptionId, true);
      canceledPaddleSubscriptions += 1;

      const ref = refs.get(subscriptionId);
      await trackEvent({
        type: 'subscription_cancelled',
        userId,
        tenantId: ref?.tenantId ?? tenantIds[0],
        metadata: {
          plan: ref?.plan ?? 'unknown',
          subscription_id: subscriptionId,
          provider: 'paddle',
          source: 'account_deletion',
        },
      });
    } catch (err) {
      // No se tolera un 404: una suscripción cancelada sigue existiendo en
      // Paddle con status `canceled`. Un 404 suele ser una API key/entorno
      // equivocado o un id corrupto, y borrar la cuenta ahí dejaría el cobro
      // vivo. Mejor abortar y que lo revise soporte.
      logger.error('Error cancelling Paddle subscription before deleting account:', {
        error: err,
        subscriptionId,
      });
      return {
        ok: false,
        error:
          'No se pudo cancelar tu suscripción. No borramos la cuenta para evitar cobros futuros. Intentá de nuevo en unos minutos.',
        status: 502,
      };
    }
  }

  for (const preapprovalId of mercadoPagoIds) {
    try {
      const preapproval = await getPreApprovalById(preapprovalId);
      const status = (preapproval as { status?: string } | null)?.status;
      if (status === 'cancelled' || status === 'canceled') continue;

      await cancelPreApproval(preapprovalId);
      canceledMercadoPagoPreapprovals += 1;

      if (currentMercadoPagoIds.has(preapprovalId)) {
        const ref = refs.get(preapprovalId);
        await trackEvent({
          type: 'subscription_cancelled',
          userId,
          tenantId: ref?.tenantId ?? tenantIds[0],
          metadata: {
            plan: ref?.plan ?? 'unknown',
            preapproval_id: preapprovalId,
            provider: 'mercadopago',
            source: 'account_deletion',
          },
        });
      }
    } catch (err) {
      logger.error('Error cancelling MercadoPago preapproval before deleting account:', {
        error: err,
        preapprovalId,
      });
      return {
        ok: false,
        error:
          'No se pudo cancelar tu suscripción. No borramos la cuenta para evitar cobros futuros. Intentá de nuevo en unos minutos.',
        status: 502,
      };
    }
  }

  for (const transaction of pendingPaddleTransactions) {
    if (
      transaction.status === 'canceled' ||
      transaction.status === 'completed' ||
      transaction.status === 'paid'
    ) {
      continue;
    }
    try {
      await cancelPaddleTransaction(transaction.id);
      canceledPaddleTransactions += 1;
    } catch (err) {
      logger.warn('No se pudo cancelar una transacción pendiente de Paddle:', {
        error: err,
        transactionId: transaction.id,
      });
    }
  }

  const update: Record<string, unknown> = {
    paddle_subscription_id: null,
    paddle_pending_transaction_id: null,
    paddle_pending_plan: null,
    paddle_price_id: null,
    mercadopago_preapproval_id: null,
    mercadopago_pending_preapproval_id: null,
    mercadopago_pending_plan: null,
  };
  if (hasActiveSubscriptionId) {
    update.subscription_status = 'canceled';
    update.subscription_plan = 'free';
  }

  const { error: updateError } = await supabaseAdmin
    .from('tenants')
    .update(update)
    .in('id', tenantIds);

  if (updateError) {
    logger.error('DB error clearing subscriptions after cancelling them:', {
      error: updateError,
    });
    return {
      ok: false,
      error: 'Se canceló el cobro, pero no se pudo actualizar el estado local. Intentá de nuevo.',
      status: 500,
    };
  }

  return {
    ok: true,
    data: {
      canceledPaddleSubscriptions,
      canceledMercadoPagoPreapprovals,
      canceledPaddleTransactions,
    },
  };
}
