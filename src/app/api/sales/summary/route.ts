import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(request: Request) {
  try {
    const auth = await getAuth(request);
    if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    const tenantId = auth.allTenants ? null : auth.tenantId;

    const { searchParams } = new URL(request.url);
    const daysParam = Number(searchParams.get('days')) || 7;
    const days = [7, 30, 90, 365].includes(daysParam) ? daysParam : 7;

    const since = new Date();
    since.setDate(since.getDate() - (days - 1));
    since.setHours(0, 0, 0, 0);
    const sinceDay = since.toISOString().slice(0, 10);

    // Lee la vista agregada sales_daily_totals (sum(total_cents) por día,
    // calculado en la base). El filtro por tenant/date lo aplica el endpoint.
    let sQuery = supabaseAdmin
      .from('sales_daily_totals')
      .select('day, total')
      .gte('day', sinceDay);
    if (!auth.allTenants) sQuery = sQuery.eq('tenant_id', tenantId);
    const res = (await sQuery) as unknown as {
      data: Array<{ day: string; total: number }> | null;
      error: { message: string } | null;
    };
    const { data: grouped, error } = res;

    if (error) { console.error('DB error:', error); return NextResponse.json({ error: 'Ocurrio un error inesperado. Intenta de nuevo.' }, { status: 500 }); }

    const dailyTotals: Record<string, number> = {};
    for (let i = 0; i < days; i++) {
      const date = new Date();
      date.setDate(date.getDate() - (days - 1 - i));
      const key = date.toISOString().slice(0, 10);
      dailyTotals[key] = 0;
    }

    for (const row of (grouped ?? [])) {
      const day = String(row.day as string).slice(0, 10);
      if (dailyTotals[day] !== undefined) {
        dailyTotals[day] += (row.total as number) || 0;
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
