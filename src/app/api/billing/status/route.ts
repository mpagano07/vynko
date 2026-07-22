import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { createServerSupabaseClient } from '@/lib/supabase';
import { PLANS } from '@/lib/plans';

export async function GET() {
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
    .select('subscription_status, subscription_plan, subscription_current_period_end, created_at')
    .eq('id', tu[0].tenant_id)
    .single();

  const plan = (tenant?.subscription_plan as keyof typeof PLANS) || 'starter';
  const planConfig = PLANS[plan] || PLANS.starter;

  const TRIAL_DAYS = 45;
  const trialEndsAt = tenant?.created_at
    ? new Date(new Date(tenant.created_at).getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString()
    : null;

  return NextResponse.json({
    plan: plan,
    planName: planConfig.name,
    status: tenant?.subscription_status || 'inactive',
    currentPeriodEnd: tenant?.subscription_current_period_end,
    trialEndsAt,
    createdAt: tenant?.created_at,
    features: planConfig.features,
  });
}
