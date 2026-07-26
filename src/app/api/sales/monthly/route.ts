import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(request: Request) {
  try {
    const auth = await getAuth(request);
    if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    const tenantId = auth.tenantId;

    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

    let tmQuery = supabaseAdmin.from('sales').select('total_cents').gte('created_at', thisMonthStart.toISOString()).eq('status', 'completed');
    let pmQuery = supabaseAdmin.from('sales').select('total_cents').gte('created_at', prevMonthStart.toISOString()).lte('created_at', prevMonthEnd.toISOString()).eq('status', 'completed');
    if (!auth.allTenants) {
      tmQuery = tmQuery.eq('tenant_id', tenantId);
      pmQuery = pmQuery.eq('tenant_id', tenantId);
    }
    const [thisMonthRes, prevMonthRes] = await Promise.all([tmQuery, pmQuery]);

    const thisMonthSales = thisMonthRes.data ?? [];
    const prevMonthSales = prevMonthRes.data ?? [];

    const thisTotal = thisMonthSales.reduce((sum, s) => sum + ((s.total_cents as number) || 0), 0) / 100;
    const prevTotal = prevMonthSales.reduce((sum, s) => sum + ((s.total_cents as number) || 0), 0) / 100;
    const thisCount = thisMonthSales.length;
    const prevCount = prevMonthSales.length;

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
