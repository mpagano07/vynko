import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(request: Request) {
  try {
    const auth = await getAuth(request);
    if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    const tenantId = auth.tenantId;

    const { searchParams } = new URL(request.url);
    const daysParam = Number(searchParams.get('days')) || 7;
    const days = [7, 30, 90, 365].includes(daysParam) ? daysParam : 7;

    const since = new Date();
    since.setDate(since.getDate() - (days - 1));
    since.setHours(0, 0, 0, 0);

    let sQuery = supabaseAdmin
      .from('sales')
      .select('created_at, total_cents')
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: true });
    if (!auth.allTenants) sQuery = sQuery.eq('tenant_id', tenantId);
    const { data: sales, error } = await sQuery;

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
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error in sales summary';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
