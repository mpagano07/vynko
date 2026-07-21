import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { createServerSupabaseClient } from '@/lib/supabase';

export async function GET(request: Request) {
  try {
    let userId: string | null = null;
    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '');
      const { data: userData } = await supabaseAdmin.auth.getUser(token);
      userId = userData?.user?.id || null;
    }
    if (!userId) {
      const supabase = await createServerSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      userId = user?.id || null;
    }
    if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: tu } = await supabaseAdmin
      .from('tenant_users')
      .select('tenant_id')
      .eq('user_id', userId);
    if (!tu || tu.length === 0) return NextResponse.json({ error: 'No tenant' }, { status: 401 });
    const tenantId = tu[0].tenant_id;

    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

    const [thisMonthRes, prevMonthRes] = await Promise.all([
      supabaseAdmin
        .from('sales')
        .select('total_cents')
        .eq('tenant_id', tenantId)
        .gte('created_at', thisMonthStart.toISOString())
        .eq('status', 'completed'),
      supabaseAdmin
        .from('sales')
        .select('total_cents')
        .eq('tenant_id', tenantId)
        .gte('created_at', prevMonthStart.toISOString())
        .lte('created_at', prevMonthEnd.toISOString())
        .eq('status', 'completed'),
    ]);

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
