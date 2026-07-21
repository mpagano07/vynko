import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { createServerSupabaseClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

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

    const { data: allProducts } = await supabaseAdmin
      .from('products')
      .select('id, name, sku, stock, min_stock')
      .eq('tenant_id', tenantId);

    const criticalProducts = (allProducts ?? [])
      .filter(p => {
        const stock = (p.stock as number) ?? 0;
        const minStock = (p.min_stock as number) ?? 0;
        return stock <= minStock;
      })
      .slice(0, 15);

    if (!criticalProducts || criticalProducts.length === 0) {
      return NextResponse.json([]);
    }

    const productIds = criticalProducts.map(p => p.id);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: recentSales } = await supabaseAdmin
      .from('sales')
      .select('id, created_at')
      .eq('tenant_id', tenantId)
      .gte('created_at', thirtyDaysAgo.toISOString())
      .order('created_at', { ascending: false })
      .limit(100);

    const recentSaleIds = (recentSales ?? []).map(s => s.id);
    const saleDateMap: Record<string, string> = {};
    for (const s of (recentSales ?? [])) {
      saleDateMap[s.id] = s.created_at as string;
    }

    const { data: saleItems } = recentSaleIds.length > 0
      ? await supabaseAdmin
          .from('sale_items')
          .select('product_id, quantity, sale_id')
          .in('product_id', productIds)
          .in('sale_id', recentSaleIds)
      : { data: [] };

    const productSales: Record<string, { totalQty: number; lastSale: string | null; weeklyAvg: number; daysLeft: number }> = {};

    for (const pid of productIds) {
      const items = (saleItems ?? []).filter(si => si.product_id === pid);
      const totalQty = items.reduce((sum, i) => sum + ((i.quantity as number) || 0), 0);
      const dates = items.map(i => saleDateMap[i.sale_id as string]).filter(Boolean).sort().reverse();
      const lastSale = dates.length > 0 ? dates[0] : null;
      const weeklyAvg = totalQty / 4;
      const product = criticalProducts.find(p => p.id === pid);
      const currentStock = (product?.stock as number) || 0;
      const daysLeft = weeklyAvg > 0 ? Math.round((currentStock / weeklyAvg) * 7) : Infinity;

      productSales[pid] = { totalQty, lastSale, weeklyAvg, daysLeft };
    }

    const enriched = criticalProducts.map(p => {
      const stats = productSales[p.id] || { totalQty: 0, lastSale: null, weeklyAvg: 0, daysLeft: Infinity };
      const stock = (p.stock as number) || 0;
      const minStock = (p.min_stock as number) || 0;

      let suggestedAction: string;
      if (stock === 0) {
        suggestedAction = 'Reposición urgente sin stock.';
      } else if (stats.daysLeft <= 3) {
        suggestedAction = 'Comprar esta semana antes del viernes.';
      } else if (stats.daysLeft <= 7) {
        suggestedAction = 'Planificar compra para los próximos días.';
      } else {
        suggestedAction = 'Monitorear y reponer pronto.';
      }

      return {
        id: p.id,
        name: p.name,
        sku: p.sku,
        stock,
        min_stock: minStock,
        lastSale: stats.lastSale,
        weeklyAvg: Math.round(stats.weeklyAvg * 10) / 10,
        daysLeft: stats.daysLeft === Infinity ? null : stats.daysLeft,
        suggestedAction,
      };
    });

    enriched.sort((a, b) => {
      if (a.stock === 0 && b.stock !== 0) return -1;
      if (b.stock === 0 && a.stock !== 0) return 1;
      return (a.daysLeft ?? 999) - (b.daysLeft ?? 999);
    });

    return NextResponse.json(enriched);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error in stock analysis';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
