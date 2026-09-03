import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

const ADMIN_EMAIL = 'matias.pagano07@gmail.com';

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || user.email !== ADMIN_EMAIL) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [signupsResult, paymentsResult, productsTenants, salesTenants, recentResult] = await Promise.all([
    supabaseAdmin
      .from('analytics_events')
      .select('id', { count: 'exact', head: true })
      .eq('event_type', 'signup'),
    supabaseAdmin
      .from('analytics_events')
      .select('id', { count: 'exact', head: true })
      .eq('event_type', 'payment'),
    supabaseAdmin
      .from('product_stock')
      .select('tenant_id, created_at')
      .eq('active', true),
    supabaseAdmin
      .from('sales')
      .select('tenant_id, created_at'),
    supabaseAdmin
      .from('analytics_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  const totalSignups = signupsResult.count ?? 0;
  const totalPayments = paymentsResult.count ?? 0;
  const conversionRate = totalSignups > 0 ? Math.round((totalPayments / totalSignups) * 100) : 0;

  const activatedTenantIds = new Set<string>();
  const firstActivityByTenant = new Map<string, Date>();
  for (const row of productsTenants.data ?? []) {
    activatedTenantIds.add(row.tenant_id);
    const date = new Date(row.created_at);
    const current = firstActivityByTenant.get(row.tenant_id);
    if (!current || date < current) firstActivityByTenant.set(row.tenant_id, date);
  }
  for (const row of salesTenants.data ?? []) {
    activatedTenantIds.add(row.tenant_id);
    const date = new Date(row.created_at);
    const current = firstActivityByTenant.get(row.tenant_id);
    if (!current || date < current) firstActivityByTenant.set(row.tenant_id, date);
  }
  const totalActivated = activatedTenantIds.size;
  const activationRate = totalSignups > 0 ? Math.round((totalActivated / totalSignups) * 100) : 0;

  const now = new Date();
  const signupsByMonth: { month: string; count: number }[] = [];
  const paymentsByMonth: { month: string; count: number }[] = [];
  const activationsByMonth: { month: string; count: number }[] = [];

  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthLabel = d.toLocaleDateString('es-AR', { month: 'short', year: '2-digit' });
    signupsByMonth.push({ month: monthLabel, count: 0 });
    paymentsByMonth.push({ month: monthLabel, count: 0 });
    activationsByMonth.push({ month: monthLabel, count: 0 });
  }

  const { data: allEvents } = await supabaseAdmin
    .from('analytics_events')
    .select('event_type, created_at');

  if (allEvents) {
    for (const event of allEvents) {
      const d = new Date(event.created_at);
      const monthLabel = d.toLocaleDateString('es-AR', { month: 'short', year: '2-digit' });
      const target = event.event_type === 'signup' ? signupsByMonth : paymentsByMonth;
      const bucket = target.find((b) => b.month === monthLabel);
      if (bucket) bucket.count++;
    }
  }

  for (const date of firstActivityByTenant.values()) {
    const monthLabel = date.toLocaleDateString('es-AR', { month: 'short', year: '2-digit' });
    const bucket = activationsByMonth.find((b) => b.month === monthLabel);
    if (bucket) bucket.count++;
  }

  return NextResponse.json({
    totalSignups,
    totalActivated,
    totalPayments,
    activationRate,
    conversionRate,
    signupsByMonth,
    activationsByMonth,
    paymentsByMonth,
    recentEvents: recentResult.data ?? [],
  });
}
