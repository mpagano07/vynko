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

  const [signupsResult, paymentsResult, recentResult] = await Promise.all([
    supabaseAdmin
      .from('analytics_events')
      .select('id', { count: 'exact', head: true })
      .eq('event_type', 'signup'),
    supabaseAdmin
      .from('analytics_events')
      .select('id', { count: 'exact', head: true })
      .eq('event_type', 'payment'),
    supabaseAdmin
      .from('analytics_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  const totalSignups = signupsResult.count ?? 0;
  const totalPayments = paymentsResult.count ?? 0;
  const conversionRate = totalSignups > 0 ? Math.round((totalPayments / totalSignups) * 100) : 0;

  const now = new Date();
  const signupsByMonth: { month: string; count: number }[] = [];
  const paymentsByMonth: { month: string; count: number }[] = [];

  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthLabel = d.toLocaleDateString('es-AR', { month: 'short', year: '2-digit' });
    signupsByMonth.push({ month: monthLabel, count: 0 });
    paymentsByMonth.push({ month: monthLabel, count: 0 });
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

  return NextResponse.json({
    totalSignups,
    totalPayments,
    conversionRate,
    signupsByMonth,
    paymentsByMonth,
    recentEvents: recentResult.data ?? [],
  });
}
