import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { getPreApprovalById, verifyMercadoPagoSignature } from '@/lib/mercadopago';

export async function POST(request: Request) {
  const body = await request.json();
  const id = body.data?.id || body.id;

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

      if (status === 'authorized') {
        const reason = preapproval.reason || '';
        let planToSet: 'starter' | 'business' | null = null;
        if (reason.includes('Business')) planToSet = 'business';
        else if (reason.includes('Starter')) planToSet = 'starter';

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
          .eq('id', externalRef);

        if (planToSet === 'business') {
          await supabaseAdmin
            .from('product_stock')
            .update({ active: true })
            .eq('tenant_id', externalRef);
        }
      } else if (status === 'cancelled') {
        const { data: tenantRow } = await supabaseAdmin
          .from('tenants')
          .select('subscription_plan, mercadopago_preapproval_id')
          .eq('id', externalRef)
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
          .eq('id', externalRef);
      } else if (status === 'pending') {
      }
    }
  } catch (err) {
    console.error('MercadoPago webhook error:', err);
  }

  return NextResponse.json({ received: true });
}
