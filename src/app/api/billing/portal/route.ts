import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { createServerSupabaseClient } from '@/lib/supabase';
import { cancelPreApproval } from '@/lib/mercadopago';

export async function POST() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data: tu } = await supabaseAdmin
    .from('tenant_users')
    .select('tenant_id')
    .eq('user_id', user.id);
  if (!tu || tu.length === 0) return NextResponse.json({ error: 'No tenant' }, { status: 401 });

  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('mercadopago_preapproval_id, subscription_current_period_end')
    .eq('id', tu[0].tenant_id)
    .single();

  if (!tenant?.mercadopago_preapproval_id) {
    return NextResponse.json({ error: 'Sin suscripción activa' }, { status: 400 });
  }

  await cancelPreApproval(tenant.mercadopago_preapproval_id);

  await supabaseAdmin
    .from('tenants')
    .update({
      subscription_status: 'canceled',
      subscription_plan: 'free',
      mercadopago_preapproval_id: null,
      subscription_current_period_end: tenant.subscription_current_period_end ?? null,
    })
    .eq('id', tu[0].tenant_id);

  return NextResponse.json({ success: true });
}
