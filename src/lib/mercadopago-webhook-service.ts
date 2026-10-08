import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { getPreApprovalById } from '@/lib/mercadopago';
import { trackEvent } from '@/lib/track-event';
import {
  recordWebhookEvent,
  type WebhookOutcome,
} from '@/lib/mercadopago-webhook-log';
import { scheduleAfterBackground } from '@/lib/after-background';
import { logger } from '@/lib/logger';

export type MercadoPagoWebhookResult =
  | { ok: true; data: { received: true } }
  | { ok: false; error: string; status: number };

export async function processMercadoPagoWebhook(
  id: string | undefined,
  topic: unknown,
  deliveryId?: string
): Promise<MercadoPagoWebhookResult> {
  const startedAt = Date.now();

  // Como termino este evento. Se actualiza a medida que se avanza y se escribe
  // en `webhook_events` una sola vez al final, con `after` para que el round
  // trip no-shape parte de la respuesta que espera MercadoPago.
  let outcome: WebhookOutcome = 'ignored';
  let mpStatus: string | null = null;
  let resolvedTenantId: string | null = null;
  let resolvedUserId: string | null = null;

  const logOutcome = (finalOutcome: WebhookOutcome, error?: string) => {
    if (!id) return;
    scheduleAfterBackground(() =>
      recordWebhookEvent({
        providerEventId: id,
        deliveryId,
        topic: typeof topic === 'string' ? topic : String(topic ?? 'unknown'),
        mpStatus,
        outcome: finalOutcome,
        tenantId: resolvedTenantId,
        userId: resolvedUserId,
        error: error ?? null,
        durationMs: Date.now() - startedAt,
      })
    );
  };

  try {
    if (!id) {
      logOutcome('error', 'Missing id');
      return { ok: false, error: 'Missing id', status: 400 };
    }

    if (topic === 'subscription_preapproval' || topic === 'preapproval') {
      const preapproval = await getPreApprovalById(id);

      const externalRef = preapproval.external_reference;
      const status = preapproval.status;
      mpStatus = typeof status === 'string' ? status : null;

      if (!externalRef) {
        logOutcome('error', 'No external reference');
        return { ok: false, error: 'No external reference', status: 400 };
      }

      const refParts = String(externalRef).split(':');
      const tenantId = refParts[0];
      const refPlan = refParts.length > 1 ? refParts[1] : null;
      const validRefPlan =
        refPlan === 'starter' || refPlan === 'business' ? (refPlan as 'starter' | 'business') : null;

      resolvedTenantId = tenantId || null;

      if (!tenantId) {
        logOutcome('error', 'No external reference');
        return { ok: false, error: 'No external reference', status: 400 };
      }

      // Every branch of the same owner shares a single subscription, so a
      // change applies to all of the owner's branches (not just the paying one).
      const ownerBranchIds: string[] = await resolveOwnerBranchIds(tenantId, [tenantId]);

      // El webhook lo llama MercadoPago, no el usuario: no hay sesion de
      // donde sacar el user_id. Se resuelve por la misma rama que ya se
      // esta usando para el update. Sin esto el evento queda sin atribuir
      // y la persona no cuenta en ningun paso del embudo, que es
      // exactamente el paso ("pagan") que mas importa no perder.
const ownerUserId = await resolveOwnerUserId(tenantId);
      resolvedUserId = ownerUserId;

      if (status === 'authorized') {
        const reason = preapproval.reason || '';
        let planToSet: 'starter' | 'business' | null = validRefPlan;
        if (!planToSet) {
          if (reason.includes('Business')) planToSet = 'business';
          else if (reason.includes('Starter')) planToSet = 'starter';
        }

        // Dos escrituras con disparadores distintos a proposito.
        //
        // La TRANSICION solo debe aplicarse cuando la rama no estaba ya activa.
        // MercadoPago reenvia `authorized` en cada cobro mensual y duplica
        // entregas, asi que sin este filtro cada renewal reescribia el estado y
        // volvia a emitir `subscription_started`: el embudo contaba un "Empezo
        // a pagar" por cada mes pagado. El `.neq(...)` va DENTRO del WHERE, que
        // es lo que lo convierte en compare-and-set: si dos entregas del mismo
        // evento llegan simultaneas, la segunda espera el lock de fila,
        // reevalua el WHERE contra la fila ya actualizada y no matchea.
        const transitionData: Record<string, unknown> = { subscription_status: 'active' };
        if (planToSet) transitionData.subscription_plan = planToSet;

        const { data: transitionedRows, error: transitionError } = await supabaseAdmin
          .from('tenants')
          .update(transitionData)
          .in('id', ownerBranchIds)
          .neq('subscription_status', 'active')
          .select('id');

        // Un update que falla no es un no-op: es una suscripcion pagada que no
        // llego a activarse. Se propaga para devolver 500 y que MercadoPago
        // reintente, en vez de responder 200 y dar el evento por perdido.
        if (transitionError) throw transitionError;

        const transitioned = !Array.isArray(transitionedRows) || transitionedRows.length > 0;

        // El CAS de arriba solo escribe cuando la rama NO estaba activa. Ese es
        // exactamente el caso de un upgrade (starter -> business): el checkout no
        // cambia `subscription_status`, asi que el webhook llega con la rama ya
        // active y el plan quedaba sin escribir (pago cobrado con el plan viejo).
        //
        // Antes de aplicarlo se descarta el evento de una suscripcion que ya no es
        // la vigente, con la misma regla que el branch de cancelacion: la renovacion
        // de un preapproval viejo (el upgrade no cancela al anterior) reescribiria
        // el plan recien pagado y el tenant bajaria de plan sin que nadie lo decida.
        let planApplied = false;
        if (!transitioned) {
          const { data: tenantRow, error: currentError } = await supabaseAdmin
            .from('tenants')
            .select('mercadopago_preapproval_id, subscription_plan, mercadopago_pending_preapproval_id, mercadopago_pending_plan')
            .eq('id', tenantId)
            .maybeSingle();
          if (currentError) throw currentError;

          const currentPreapprovalId = tenantRow?.mercadopago_preapproval_id ?? null;
          const pendingId = tenantRow?.mercadopago_pending_preapproval_id ?? null;
          const pendingPlan = tenantRow?.mercadopago_pending_plan ?? null;
          const pendingMatches = pendingId && pendingId === id;

          if (pendingMatches && pendingPlan) {
            planToSet = pendingPlan as 'starter' | 'business';
          }

          if (currentPreapprovalId !== null && currentPreapprovalId !== id && !pendingMatches) {
            logOutcome('ignored', 'Plan de una suscripcion que ya no es la vigente');
            return { ok: true, data: { received: true } };
          }

          if (planToSet && tenantRow?.subscription_plan !== planToSet && !pendingMatches) {
            const { error: planError } = await supabaseAdmin
              .from('tenants')
              .update({ subscription_plan: planToSet })
              .in('id', ownerBranchIds);
            if (planError) throw planError;
            planApplied = true;
          }
        }

        // El periodo se refresca en cada entrega, incluido cada renewal: esto
        // es nivel, no arista. Si se gateara con la transicion, el renewal no
        // moveria `subscription_current_period_end` y el gate de acceso
        // entenderia que la suscripcion vencio.
        const periodData: Record<string, unknown> = { mercadopago_preapproval_id: id };
        if (preapproval.next_payment_date) {
          periodData.subscription_current_period_end = preapproval.next_payment_date;
        }

        const { error: periodError } = await supabaseAdmin
          .from('tenants')
          .update(periodData)
          .in('id', ownerBranchIds);

        if (periodError) throw periodError;

        // Solo en la arista: reactivar stock en cada renewal volveria a encender
        // productos que el usuario apago a proposito.
        if (planToSet === 'business' && transitioned) {
          const { error: stockError } = await supabaseAdmin
            .from('product_stock')
            .update({ active: true })
            .in('tenant_id', ownerBranchIds);

          if (stockError) throw stockError;
        }

        // Antes era event_type 'payment'. Se renombra a subscription_started
        // porque "payment" no distingue una suscripcion nueva de un renewal,
        // y el embudo necesita la primera vez que la persona empezó a pagar.
        // Las filas viejas con 'payment' siguen en la tabla; el service de
        // analytics las cuenta como subscription_started para que no se
        // pierda el historico.
        if (transitioned && ownerUserId) {
          await trackEvent({
            type: 'subscription_started',
            userId: ownerUserId,
            tenantId,
            metadata: { plan: planToSet ?? 'business', preapproval_id: id },
          });
        }

        // Aplicar cambios de downgrade pendientes cuando este preapproval es el
        // creado para el cambio (business->starter). Esto hace efectivo el plan
        // destino, cancela el preapproval viejo y limpia el pendiente.
        const { data: pendingTenant } = await supabaseAdmin
          .from('tenants')
          .select('mercadopago_pending_preapproval_id, mercadopago_pending_plan, mercadopago_preapproval_id, subscription_plan')
          .eq('id', tenantId)
          .maybeSingle();
        const pendingId = pendingTenant?.mercadopago_pending_preapproval_id ?? null;
        const pendingPlan = pendingTenant?.mercadopago_pending_plan ?? null;
        if (pendingId && pendingId === id && pendingPlan) {
          const oldPreapprovalId = pendingTenant?.mercadopago_preapproval_id ?? null;
          const updates: Record<string, unknown> = {
            subscription_plan: pendingPlan,
            mercadopago_pending_preapproval_id: null,
            mercadopago_pending_plan: null,
          };
          const { error: applyPendingError } = await supabaseAdmin
            .from('tenants')
            .update(updates)
            .in('id', ownerBranchIds);
          if (applyPendingError) throw applyPendingError;
          if (oldPreapprovalId && oldPreapprovalId !== id) {
            try {
              await (await import('@/lib/mercadopago')).cancelPreApproval(oldPreapprovalId);
            } catch (err) {
              logger.error('Error cancelling old preapproval after downgrade:', { error: err });
            }
          }
          planApplied = true;
        }

        // `processed` = hubo arista (la rama no estaba activa o el plan cambio).
        // `duplicate` = llego de nuevo o es un renewal: el periodo se refresco
        // igual, pero no hubo cambio de estado ni evento que contar. Distinguir
        // los dos es lo que hace util la bitacora: un renewal legitimate no debe
        // verse igual que un evento repetido por error.
        outcome = transitioned || planApplied ? 'processed' : 'duplicate';
      } else if (status === 'cancelled') {
        const { data: tenantRow } = await supabaseAdmin
          .from('tenants')
          .select('subscription_plan, mercadopago_preapproval_id, mercadopago_pending_preapproval_id')
          .eq('id', tenantId)
          .single();

        const currentPlan = tenantRow?.subscription_plan;
        const planToSet = currentPlan === 'business' || currentPlan === 'enterprise' ? 'free' : currentPlan;

        // Webhook obsoleto: esta cancelacion pertenece a una suscripcion que ya
        // no es la vigente (el owner se resuscribio y el tenant ya tiene otro
        // preapproval_id). Aplicarla dejaria cancelada una suscripcion que si se
        // esta pagando, que es peor que ignorarla. Se responde 200 sin tocar
        // nada para que MercadoPago deje de reintentar.
        const currentPreapprovalId = tenantRow?.mercadopago_preapproval_id ?? null;
        const pendingId = tenantRow?.mercadopago_pending_preapproval_id ?? null;
        const isPendingCancelled = pendingId && pendingId === id;
        if (isPendingCancelled) {
          const { error: clearError } = await supabaseAdmin
            .from('tenants')
            .update({ mercadopago_pending_preapproval_id: null, mercadopago_pending_plan: null })
            .in('id', ownerBranchIds);
          if (clearError) throw clearError;
          logOutcome('ignored', 'Cancelacion de intento de cambio de plan');
          return { ok: true, data: { received: true } };
        }
        if (currentPreapprovalId !== null && currentPreapprovalId !== id) {
          logOutcome('ignored', 'Cancelacion de una suscripcion que ya no es la vigente');
          return { ok: true, data: { received: true } };
        }

        // A partir de aqui el preapproval_id guardado es este mismo o null, asi
        // que limpiarlo siempre es correcto.
        const updateData: Record<string, unknown> = {
          subscription_status: 'canceled',
          subscription_plan: planToSet,
          mercadopago_preapproval_id: null,
        };

        const { data: cancelledRows, error: cancelError } = await supabaseAdmin
          .from('tenants')
          .update(updateData)
          .in('id', ownerBranchIds)
          .neq('subscription_status', 'canceled')
          .select('id');

        if (cancelError) throw cancelError;

        const transitioned = !Array.isArray(cancelledRows) || cancelledRows.length > 0;

        // Se emite con el plan ANTERIOR, no con planToSet: planToSet es 'free'
        // para business/enterprise, y guardar 'free' como plan cancelado
        // pierde el dato de que cancelaba un plan pago.
        if (transitioned && ownerUserId) {
          await trackEvent({
            type: 'subscription_cancelled',
            userId: ownerUserId,
            tenantId,
            metadata: { plan: currentPlan ?? 'unknown', preapproval_id: id, source: 'webhook' },
          });
        }

        outcome = transitioned ? 'processed' : 'duplicate';
      } else if (status === 'paused') {
        const { data: tenantRow } = await supabaseAdmin
          .from('tenants')
          .select('mercadopago_preapproval_id, mercadopago_pending_preapproval_id')
          .eq('id', tenantId)
          .single();
        const currentPreapprovalId = tenantRow?.mercadopago_preapproval_id ?? null;
        const pendingId = tenantRow?.mercadopago_pending_preapproval_id ?? null;
        const isPendingPaused = pendingId && pendingId === id;
        if (isPendingPaused) {
          const { error: clearError } = await supabaseAdmin
            .from('tenants')
            .update({ mercadopago_pending_preapproval_id: null, mercadopago_pending_plan: null })
            .in('id', ownerBranchIds);
          if (clearError) throw clearError;
          logOutcome('ignored', 'Pago pausado en intento de cambio de plan');
          return { ok: true, data: { received: true } };
        }
        if (currentPreapprovalId !== null && currentPreapprovalId !== id) {
          logOutcome('ignored', 'Paused de una suscripcion que ya no es la vigente');
          return { ok: true, data: { received: true } };
        }
        // Subscription paused by MercadoPago (e.g. failed payment attempts)
        // Mark as past_due so the subscription gate blocks access. Applies to
        // all of the owner's branches (shared subscription).
        const { error: pausedError } = await supabaseAdmin
          .from('tenants')
          .update({ subscription_status: 'past_due' })
          .in('id', ownerBranchIds)
          .neq('subscription_status', 'past_due');

        if (pausedError) throw pausedError;

        outcome = 'processed';
      } else {
        // `pending` y cualquier estado que no sea de transicion: se responde 200
        // para que MercadoPago no lo reintente, pero se registra como ignorado
        // para que se pueda ver que llego y no se hizo nada.
        outcome = 'ignored';
      }
    }

    logOutcome(outcome);
  } catch (err) {
    logger.error('MercadoPago webhook error:', { error: err });
    logOutcome('error', err instanceof Error ? err.message : String(err));
    // 500 y no 200: con 200 MercadoPago da el evento por procesado y no
    // reintenta, asi que un fallo transitorio (red, API de MP caida) se pierde
    // para siempre y el tenant queda sin activar sin que nadie lo note. Un 5xx
    // hace que MercadoPago reintente con su propia politica de backoff.
    return { ok: false, error: 'Webhook processing failed', status: 500 };
  }

  return { ok: true, data: { received: true } };
}

/**
 * Resolves every branch (tenant) that belongs to the same owner of the given
 * tenant so that subscription changes are applied across all of them. Falls
 * back to just the given tenant if the owner cannot be determined.
 */
export async function resolveOwnerBranchIds(
  tenantId: string,
  fallback: string[] = [tenantId]
): Promise<string[]> {
  try {
    const ownerUserId = await resolveOwnerUserId(tenantId);
    if (!ownerUserId) return fallback;

    const { data: branches } = await supabaseAdmin
      .from('tenant_users')
      .select('tenant_id')
      .eq('user_id', ownerUserId);

    if (!branches || branches.length === 0) return fallback;
    return branches.map((b) => b.tenant_id);
  } catch {
    return fallback;
  }
}

/**
 * Dueño de la rama. El webhook de MercadoPago no tiene sesion de usuario,
 * asi que el user_id del evento de suscripcion hay que sacarlo de la
 * membresia. Devuelve null si la rama quedo sin owner, en cuyo caso el
 * evento no se graba: es preferible perder un punto de datos a atribuirle
 * la suscripcion al usuario equivocado.
 */
export async function resolveOwnerUserId(tenantId: string): Promise<string | null> {
  try {
    const { data: owner } = await supabaseAdmin
      .from('tenant_users')
      .select('user_id')
      .eq('tenant_id', tenantId)
      .eq('role', 'owner')
      .maybeSingle();

    return owner?.user_id ?? null;
  } catch {
    return null;
  }
}
