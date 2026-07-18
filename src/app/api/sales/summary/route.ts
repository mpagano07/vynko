import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { createServerSupabaseClient } from '@/lib/supabase';

export async function GET(request: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data: tu } = await supabaseAdmin
    .from('tenant_users')
    .select('tenant_id')
    .eq('user_id', user.id);
  if (!tu || tu.length === 0) return NextResponse.json({ error: 'No tenant' }, { status: 401 });
  const tenantId = tu[0].tenant_id;

  const { searchParams } = new URL(request.url);
  const daysParam = Number(searchParams.get('days')) || 7;
  const days = [7, 30, 90, 365].includes(daysParam) ? daysParam : 7;

  const since = new Date();
  since.setDate(since.getDate() - (days - 1));
  since.setHours(0, 0, 0, 0);

  const { data: sales, error } = await supabaseAdmin
    .from('sales')
    .select('created_at, total_cents')
    .eq('tenant_id', tenantId)
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const dailyTotals: Record<string, number> = {};
  for (let i = 0; i < days; i++) {
    const date = new Date();
    date.setDate(date.getDate() - (days - 1 - i));
    const key = date.toISOString().slice(0, 10);
    dailyTotals[key] = 0;
  }

  for (const sale of (sales ?? [])) {
    const day = (sale.created_at as string).slice(0, 10);
    if (dailyTotals[day] !== undefined) {
      dailyTotals[day] += (sale.total_cents as number) || 0;
    }
  }

  const shortDays = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const shortMonths = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

  const formatted = Object.entries(dailyTotals).map(([date, total]) => {
    const d = new Date(date + 'T12:00:00');
    let label: string;
    if (days <= 31) {
      label = shortDays[d.getDay()];
    } else {
      label = `${d.getDate()} ${shortMonths[d.getMonth()]}`;
    }
    return {
      date,
      day: label,
      total: total / 100,
    };
  });

  return NextResponse.json(formatted);
}
