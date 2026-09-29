import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { getPreApprovalById } from '@/lib/mercadopago';
import { trackEvent } from '@/lib/track-event';

export type MercadoPagoWebhookResult =
  | { ok: true; data: { received: true } }
  | { ok: false; error: string; status: number };

export async function processMercadoPagoWebhook(id: string | undefined, topic: unknown): Promise<MercadoPagoWebhookResult> {
  try {
    if (!id) {
      return { ok: false, error: 'Missing id', status: 400 };
    }

    if (topic === 'subscription_preapproval' || topic === 'preapproval') {
      const preapproval = await getPreApprovalById(id);

      const externalRef = preapproval.external_reference;
      const status = preapproval.status;

      if (!externalRef) {
        return { ok: false, error: 'No external reference', status: 400 };
      }

      const refParts = String(externalRef).split(':');
      const tenantId = refParts[0];
      const refPlan = refParts.length > 1 ? refParts[1] : null;
      const validRefPlan =
        refPlan === 'starter' || refPlan === 'business' ? (refPlan as 'starter' | 'business') : null;

      if (!tenantId) {
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

      if (status === 'authorized') {
        const reason = preapproval.reason || '';
        let planToSet: 'starter' | 'business' | null = validRefPlan;
        if (!planToSet) {
          if (reason.includes('Business')) planToSet = 'business';
          else if (reason.includes('Starter')) planToSet = 'starter';
        }

        const updateData: Record<string, unknown> = {
          subscription_status: 'active',
          mercadopago_preapproval_id: id,
        };
        if (planToSet) updateData.subscription_plan = planToSet;
        if (preapproval.next_payment_date) {
          updateData.subscription_current_period_end = preapproval.next_payment_date;
        }

        await supabaseAdmin
          .from('tenants')
          .update(updateData)
          .in('id', ownerBranchIds);

        if (planToSet === 'business') {
          await supabaseAdmin
            .from('product_stock')
            .update({ active: true })
            .in('tenant_id', ownerBranchIds);
        }

        // Antes era event_type 'payment'. Se renombra a subscription_started
        // porque "payment" no distingue una suscripcion nueva de un renewal,
        // y el embudo necesita la primera vez que la persona empezó a pagar.
        // Las filas viejas con 'payment' siguen en la tabla; el service de
        // analytics las cuenta como subscription_started para que no se
        // pierda el historico.
        if (ownerUserId) {
          await trackEvent({
            type: 'subscription_started',
            userId: ownerUserId,
            tenantId,
            metadata: { plan: planToSet ?? 'business', preapproval_id: id },
          });
        }
      } else if (status === 'cancelled') {
        const { data: tenantRow } = await supabaseAdmin
          .from('tenants')
          .select('subscription_plan, mercadopago_preapproval_id')
          .eq('id', tenantId)
          .single();

        const currentPlan = tenantRow?.subscription_plan;
        const planToSet = currentPlan === 'business' || currentPlan === 'enterprise' ? 'free' : currentPlan;

        const updateData: Record<string, unknown> = {
          subscription_status: 'canceled',
          subscription_plan: planToSet,
        };
        if ((tenantRow?.mercadopago_preapproval_id ?? null) === id) {
          updateData.mercadopago_preapproval_id = null;
        }

        await supabaseAdmin
          .from('tenants')
          .update(updateData)
          .in('id', ownerBranchIds);

        // Se emite con el plan ANTERIOR, no con planToSet: planToSet es 'free'
        // para business/enterprise, y guardar 'free' como plan cancelado
        // pierde el dato de que cancelaba un plan pago.
        if (ownerUserId) {
          await trackEvent({
            type: 'subscription_cancelled',
            userId: ownerUserId,
            tenantId,
            metadata: { plan: currentPlan ?? 'unknown', preapproval_id: id, source: 'webhook' },
          });
        }
      } else if (status === 'paused') {
        // Subscription paused by MercadoPago (e.g. failed payment attempts)
        // Mark as past_due so the subscription gate blocks access. Applies to
        // all of the owner's branches (shared subscription).
        await supabaseAdmin
          .from('tenants')
          .update({ subscription_status: 'past_due' })
          .in('id', ownerBranchIds);
      }
      // status === 'pending' -> no action needed (waiting for first payment)
    }
  } catch (err) {
    console.error('MercadoPago webhook error:', err);
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