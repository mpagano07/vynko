import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

// Lee la vista agregada sales_monthly_totals (sum(total_cents) + count(*)
// por mes, calculado en la base) en lugar de traer filas y sumar en JS.
async function getMonthTotals(tenantId: string | null, monthStart: Date) {
  const month = monthStart.toISOString().slice(0, 10);

  let query = supabaseAdmin
    .from('sales_monthly_totals')
    .select('total, sale_count')
    .eq('month', month);
  if (tenantId) query = query.eq('tenant_id', tenantId);

  const res = (await query) as unknown as {
    data: Array<{ total: number; sale_count: number }> | null;
    error: { message: string } | null;
  };
  const { data, error } = res;
  if (error) return { error };
  const row = data?.[0];
  return {
    total: (row?.total as number) || 0,
    count: (row?.sale_count as number) || 0,
  };
}

export async function GET(request: Request) {
  try {
    const auth = await getAuth(request);
    if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    const tenantId = auth.allTenants ? null : auth.tenantId;

    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const [thisMonth, prevMonth] = await Promise.all([
      getMonthTotals(tenantId, thisMonthStart),
      getMonthTotals(tenantId, prevMonthStart),
    ]);

    if (thisMonth.error) { console.error('DB error:', thisMonth.error); return NextResponse.json({ error: 'Ocurrio un error inesperado. Intenta de nuevo.' }, { status: 500 }); }
    if (prevMonth.error) { console.error('DB error:', prevMonth.error); return NextResponse.json({ error: 'Ocurrio un error inesperado. Intenta de nuevo.' }, { status: 500 }); }

    const thisTotal = thisMonth.total / 100;
    const prevTotal = prevMonth.total / 100;
    const thisCount = thisMonth.count;
    const prevCount = prevMonth.count;

    const variationPercent = prevTotal > 0
      ? Math.round(((thisTotal - prevTotal) / prevTotal) * 100)
      : null;

    const avgTicket = thisCount > 0 ? thisTotal / thisCount : 0;

    return NextResponse.json({
      total: thisTotal,
      saleCount: thisCount,
      prevTotal,
      prevSaleCount: prevCount,
      variationPercent,
      avgTicket,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error in monthly sales';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
