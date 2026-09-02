import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { getPreApprovalById, verifyMercadoPagoSignature } from '@/lib/mercadopago';

export async function POST(request: Request) {
  // Clone the request to read the raw text for signature verification
  // while still being able to parse JSON afterwards.
  const cloned = request.clone();
  const rawText = await cloned.text();

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const data = body.data as Record<string, unknown> | undefined;
  const rawId = data?.id ?? body.id;
  const id = typeof rawId === 'string' ? rawId : undefined;
  const isValidSignature = verifyMercadoPagoSignature(request, id);
  if (!isValidSignature) {
    console.error('Invalid MercadoPago webhook signature');
    return NextResponse.json({ error: 'Unauthorized webhook request' }, { status: 401 });
  }

  try {
    const topic = body.type || body.topic;

    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }

    if (topic === 'subscription_preapproval' || topic === 'preapproval') {
      const preapproval = await getPreApprovalById(id);

      const externalRef = preapproval.external_reference;
      const status = preapproval.status;

      if (!externalRef) {
        return NextResponse.json({ error: 'No external reference' }, { status: 400 });
      }

      const refParts = String(externalRef).split(':');
      const tenantId = refParts[0];
      const refPlan = refParts.length > 1 ? refParts[1] : null;
      const validRefPlan =
        refPlan === 'starter' || refPlan === 'business' ? (refPlan as 'starter' | 'business') : null;

      if (!tenantId) {
        return NextResponse.json({ error: 'No external reference' }, { status: 400 });
      }

      // Every branch of the same owner shares a single subscription, so a
      // change applies to all of the owner's branches (not just the paying one).
      const ownerBranchIds: string[] = await resolveOwnerBranchIds(tenantId, [tenantId]);

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

        await supabaseAdmin.from('analytics_events').insert({
          event_type: 'payment',
          tenant_id: tenantId,
          metadata: { plan: planToSet ?? 'starter', preapproval_id: id },
        });
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

  return NextResponse.json({ received: true });
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
    const { data: owner } = await supabaseAdmin
      .from('tenant_users')
      .select('user_id')
      .eq('tenant_id', tenantId)
      .eq('role', 'owner')
      .maybeSingle();

    if (!owner?.user_id) return fallback;

    const { data: branches } = await supabaseAdmin
      .from('tenant_users')
      .select('tenant_id')
      .eq('user_id', owner.user_id);

    if (!branches || branches.length === 0) return fallback;
    return branches.map((b) => b.tenant_id);
  } catch {
    return fallback;
  }
}
