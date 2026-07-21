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

    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const [recentSalesRes, customersRes, purchaseRes, suppliersRes] = await Promise.all([
      supabaseAdmin
        .from('sales')
        .select('id')
        .eq('tenant_id', tenantId)
        .gte('created_at', ninetyDaysAgo.toISOString())
        .order('created_at', { ascending: false })
        .limit(200),
      supabaseAdmin
        .from('sales')
        .select('customer_id, total_cents')
        .eq('tenant_id', tenantId)
        .not('customer_id', 'is', null)
        .gte('created_at', ninetyDaysAgo.toISOString())
        .order('created_at', { ascending: false })
        .limit(200),
      supabaseAdmin
        .from('purchase_orders')
        .select('id, supplier_id, created_at')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(1),
      supabaseAdmin
        .from('purchase_orders')
        .select('supplier_id')
        .eq('tenant_id', tenantId)
        .not('supplier_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(100),
    ]);

    const saleIds = (recentSalesRes.data ?? []).map(s => s.id as string);

    let topProduct: { name: string; qty: number } | null = null;
    if (saleIds.length > 0) {
      const { data: saleItems } = await supabaseAdmin
        .from('sale_items')
        .select('product_id, quantity')
        .in('sale_id', saleIds);

      if (saleItems && saleItems.length > 0) {
        const qtyByProduct: Record<string, number> = {};
        for (const item of saleItems) {
          const pid = item.product_id as string;
          qtyByProduct[pid] = (qtyByProduct[pid] || 0) + ((item.quantity as number) || 0);
        }
        const topPid = Object.entries(qtyByProduct).sort((a, b) => b[1] - a[1])[0]?.[0];
        if (topPid) {
          const { data: prod } = await supabaseAdmin.from('products').select('name').eq('id', topPid).maybeSingle();
          topProduct = { name: prod?.name || '—', qty: qtyByProduct[topPid] };
        }
      }
    }

    let topCustomer: { name: string; total: number } | null = null;
    if (customersRes.data && customersRes.data.length > 0) {
      const totalByCustomer: Record<string, number> = {};
      for (const sale of customersRes.data) {
        const cid = sale.customer_id as string;
        totalByCustomer[cid] = (totalByCustomer[cid] || 0) + ((sale.total_cents as number) || 0);
      }
      const topCid = Object.entries(totalByCustomer).sort((a, b) => b[1] - a[1])[0]?.[0];
      if (topCid) {
        const { data: cust } = await supabaseAdmin.from('customers').select('name').eq('id', topCid).maybeSingle();
        topCustomer = { name: cust?.name || '—', total: totalByCustomer[topCid] / 100 };
      }
    }

    let lastPurchase: { date: string | null } | null = null;
    if (purchaseRes.data && purchaseRes.data.length > 0) {
      lastPurchase = { date: purchaseRes.data[0].created_at as string };
    }

    let topSupplier: { name: string } | null = null;
    if (suppliersRes.data && suppliersRes.data.length > 0) {
      const countBySupplier: Record<string, number> = {};
      for (const po of suppliersRes.data) {
        const sid = po.supplier_id as string;
        countBySupplier[sid] = (countBySupplier[sid] || 0) + 1;
      }
      const topSid = Object.entries(countBySupplier).sort((a, b) => b[1] - a[1])[0]?.[0];
      if (topSid) {
        const { data: supp } = await supabaseAdmin.from('suppliers').select('name').eq('id', topSid).maybeSingle();
        topSupplier = { name: supp?.name || '—' };
      }
    }

    return NextResponse.json({
      topProduct,
      topCustomer,
      lastPurchase,
      topSupplier,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error processing summary';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
