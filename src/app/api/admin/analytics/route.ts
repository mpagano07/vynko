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

  const [signupsResult, paymentsResult, firstActivityResult, recentResult] = await Promise.all([
    supabaseAdmin
      .from('analytics_events')
      .select('id', { count: 'exact', head: true })
      .eq('event_type', 'signup'),
    supabaseAdmin
      .from('analytics_events')
      .select('id', { count: 'exact', head: true })
      .eq('event_type', 'payment'),
    supabaseAdmin
      .from('tenant_first_activity')
      .select('tenant_id, first_activity'),
    supabaseAdmin
      .from('analytics_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  const totalSignups = signupsResult.count ?? 0;
  const totalPayments = paymentsResult.count ?? 0;
  const conversionRate = totalSignups > 0 ? Math.round((totalPayments / totalSignups) * 100) : 0;

  const firstActivityByTenant = new Map<string, Date>();
  for (const row of firstActivityResult.data ?? []) {
    firstActivityByTenant.set(row.tenant_id, new Date(row.first_activity));
  }
  const totalActivated = firstActivityByTenant.size;
  const activationRate = totalSignups > 0 ? Math.round((totalActivated / totalSignups) * 100) : 0;

  const now = new Date();
  const monthLabels: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthLabels.push(d.toLocaleDateString('es-AR', { month: 'short', year: '2-digit' }));
  }
  const signupsByMonth = monthLabels.map((m) => ({ month: m, count: 0 }));
  const paymentsByMonth = monthLabels.map((m) => ({ month: m, count: 0 }));
  const activationsByMonth = monthLabels.map((m) => ({ month: m, count: 0 }));

  const byMonth = new Map<string, { signup: number; payment: number }>();
  const { data: eventsByMonth } = await supabaseAdmin
    .from('analytics_events_by_month')
    .select('month, event_type, event_count');
  if (eventsByMonth) {
    for (const e of eventsByMonth) {
      const d = new Date(String(e.month) + 'T12:00:00');
      const label = d.toLocaleDateString('es-AR', { month: 'short', year: '2-digit' });
      const bucket = byMonth.get(label) ?? { signup: 0, payment: 0 };
      if (e.event_type === 'signup') bucket.signup += Number(e.event_count) || 0;
      else if (e.event_type === 'payment') bucket.payment += Number(e.event_count) || 0;
      byMonth.set(label, bucket);
    }
  }
  for (let i = 0; i < monthLabels.length; i++) {
    const b = byMonth.get(monthLabels[i]);
    if (b) {
      signupsByMonth[i].count = b.signup;
      paymentsByMonth[i].count = b.payment;
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
