import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { createServerSupabaseClient } from '@/lib/supabase';
import { PLANS } from '@/lib/plans';
import { createPreApproval } from '@/lib/mercadopago';

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data: tu } = await supabaseAdmin
    .from('tenant_users')
    .select('tenant_id')
    .eq('user_id', user.id);
  if (!tu || tu.length === 0) return NextResponse.json({ error: 'No tenant' }, { status: 401 });

  const tenantId = tu[0].tenant_id;

  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('name, billing_email')
    .eq('id', tenantId)
    .single();

  const { plan } = await request.json();
  const planConfig = PLANS[plan as keyof typeof PLANS];

  if (!planConfig) {
    return NextResponse.json({ error: 'Plan inválido o no disponible' }, { status: 400 });
  }

  const origin = request.headers.get('origin') || '';

  const preapproval = await createPreApproval({
    payer_email: tenant?.billing_email || user.email!,
    reason: `Suscripción ${planConfig.name} - Vynko`,
    back_url: `${origin}/billing?success=true`,
    external_reference: tenantId,
    auto_recurring: {
      frequency: 1,
      frequency_type: 'months',
      transaction_amount: planConfig.price,
      currency_id: 'ARS',
      trial_period_days: 45,
    } as any,
  });

  await supabaseAdmin
    .from('tenants')
    .update({ mercadopago_preapproval_id: preapproval.id })
    .eq('id', tenantId);

  return NextResponse.json({ url: preapproval.init_point });
}
