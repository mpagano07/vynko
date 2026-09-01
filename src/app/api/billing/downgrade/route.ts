import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { createServerSupabaseClient } from '@/lib/supabase';
import { PLANS, PLAN_ORDER, PLAN_LIMITS } from '@/lib/plans';
import type { PlanId } from '@/lib/plans';
import { cancelPreApproval, createPreApproval } from '@/lib/mercadopago';

const planRank = (plan?: string | null): number => {
  const idx = PLAN_ORDER.indexOf((plan as PlanId) || 'starter');
  return idx === -1 ? 0 : idx;
};

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { plan } = await request.json();
  const targetPlan = plan as PlanId;
  if (!PLAN_ORDER.includes(targetPlan)) {
    return NextResponse.json({ error: 'Plan inválido' }, { status: 400 });
  }

  const { data: userTenants } = await supabaseAdmin
    .from('tenant_users')
    .select('tenant_id, role')
    .eq('user_id', user.id);

  if (!userTenants || userTenants.length === 0) {
    return NextResponse.json({ error: 'Sin tenant' }, { status: 401 });
  }

  const tenantIds = userTenants.map(t => t.tenant_id as string);

  const { data: tenants } = await supabaseAdmin
    .from('tenants')
    .select('id, name, billing_email, subscription_plan, subscription_status, mercadopago_preapproval_id, created_at')
    .in('id', tenantIds);

  if (!tenants || tenants.length === 0) {
    return NextResponse.json({ error: 'Sin tenant' }, { status: 404 });
  }

  const mainTenantId = userTenants[0].tenant_id as string;
  const mainTenant = tenants.find(t => t.id === mainTenantId) || tenants[0];
  const extraTenantIds = tenants.filter(t => t.id !== mainTenant.id).map(t => t.id);

  if (planRank(mainTenant.subscription_plan) <= planRank(targetPlan)) {
    return NextResponse.json(
      { error: `Tu plan actual (${mainTenant.subscription_plan}) no permite cambiar a ${targetPlan}.` },
      { status: 400 }
    );
  }

  const ownership = userTenants.find(t => t.tenant_id === mainTenant.id && t.role === 'owner');
  if (!ownership) {
    return NextResponse.json({ error: 'Solo el propietario puede cambiar de plan' }, { status: 403 });
  }

  if (mainTenant.mercadopago_preapproval_id) {
    try {
      await cancelPreApproval(mainTenant.mercadopago_preapproval_id);
    } catch (err) {
      console.error('Error cancelling preapproval on downgrade:', err);
    }
  }

  const maxProducts = PLAN_LIMITS[targetPlan].products;
  const { data: stocks } = await supabaseAdmin
    .from('product_stock')
    .select('id')
    .eq('tenant_id', mainTenant.id)
    .eq('active', true)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });

  if (stocks && stocks.length > maxProducts) {
    const toDeactivate = stocks.slice(maxProducts).map(s => s.id);
    const { error: deactivateError } = await supabaseAdmin
      .from('product_stock')
      .update({ active: false })
      .in('id', toDeactivate);
    if (deactivateError) {
      return NextResponse.json({ error: 'Error al desactivar productos' }, { status: 500 });
    }
  }

  if (extraTenantIds.length > 0) {
    const { error: tuError } = await supabaseAdmin
      .from('tenant_users')
      .delete()
      .eq('user_id', user.id)
      .in('tenant_id', extraTenantIds);
    if (tuError) {
      return NextResponse.json({ error: 'Error al quitar sucursales' }, { status: 500 });
    }
  }

  const { error: collabError } = await supabaseAdmin
    .from('tenant_users')
    .delete()
    .eq('tenant_id', mainTenant.id)
    .neq('role', 'owner');
  if (collabError) {
    return NextResponse.json({ error: 'Error al quitar colaboradores' }, { status: 500 });
  }

  const { error: invError } = await supabaseAdmin
    .from('invitations')
    .delete()
    .eq('tenant_id', mainTenant.id)
    .is('accepted_at', null);
  if (invError) {
    return NextResponse.json({ error: 'Error al quitar invitaciones' }, { status: 500 });
  }

  const { error: planError } = await supabaseAdmin
    .from('tenants')
    .update({
      subscription_plan: targetPlan,
      subscription_status: 'canceled',
      subscription_current_period_end: null,
      mercadopago_preapproval_id: null,
    })
    .eq('id', mainTenant.id);
  if (planError) {
    { console.error('DB error:', planError); return NextResponse.json({ error: 'Ocurrio un error inesperado. Intenta de nuevo.' }, { status: 500 }); }
  }

  const targetPlanConfig = PLANS[targetPlan];
  let url: string | null = null;
  try {
    const origin = request.headers.get('origin') || '';
    const preapproval = await createPreApproval({
      payer_email: mainTenant.billing_email || user.email!,
      reason: `Suscripción ${targetPlanConfig.name} - Vynko`,
      back_url: `${origin}/billing?success=true`,
      external_reference: mainTenant.id,
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: targetPlanConfig.price,
        currency_id: 'ARS',
        trial_period_days: 0,
      },
    });

    await supabaseAdmin
      .from('tenants')
      .update({ mercadopago_preapproval_id: preapproval.id })
      .eq('id', mainTenant.id);

    url = preapproval.init_point || null;
  } catch (err) {
    console.error('Error creating starter preapproval on downgrade:', err);
  }

  return NextResponse.json({ success: true, plan: targetPlan, url });
}
