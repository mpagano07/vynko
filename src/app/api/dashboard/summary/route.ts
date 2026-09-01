import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { fixResponse } from '@/lib/utils/encoding';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const auth = await getAuth(request);
    if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    const tenantId = auth.tenantId;

    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const allTenantsBool = auth.allTenants;

    function qFilter<T extends { eq: (col: string, value: string) => unknown }>(q: T): T {
      return allTenantsBool ? q : (q.eq('tenant_id', tenantId) as T);
    }

    const [recentSalesRes, customersRes, lastSaleRes, suppliersRes] = await Promise.all([
      qFilter(
        supabaseAdmin.from('sales').select('id').gte('created_at', ninetyDaysAgo.toISOString()).order('created_at', { ascending: false }).limit(200)
      ),
      qFilter(
        supabaseAdmin.from('sales').select('customer_id, total_cents').not('customer_id', 'is', null).gte('created_at', ninetyDaysAgo.toISOString()).order('created_at', { ascending: false }).limit(200)
      ),
      qFilter(
        supabaseAdmin.from('sales').select('created_at').order('created_at', { ascending: false }).limit(1)
      ),
      qFilter(
        supabaseAdmin.from('purchase_orders').select('supplier_id').not('supplier_id', 'is', null).order('created_at', { ascending: false }).limit(100)
      ),
    ]);

    const saleIds = ((recentSalesRes.data ?? []) as { id: string }[]).map(s => s.id);

    let topPid: string | undefined;
    let topProductQty = 0;
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
        topPid = Object.entries(qtyByProduct).sort((a, b) => b[1] - a[1])[0]?.[0];
        if (topPid) {
          topProductQty = qtyByProduct[topPid];
        }
      }
    }

    let topCid: string | undefined;
    let topCustomerTotal = 0;
    if (customersRes.data && customersRes.data.length > 0) {
      const totalByCustomer: Record<string, number> = {};
      for (const sale of customersRes.data) {
        const cid = sale.customer_id as string;
        totalByCustomer[cid] = (totalByCustomer[cid] || 0) + ((sale.total_cents as number) || 0);
      }
      topCid = Object.entries(totalByCustomer).sort((a, b) => b[1] - a[1])[0]?.[0];
      if (topCid) {
        topCustomerTotal = totalByCustomer[topCid] / 100;
      }
    }

    let lastPurchase: { date: string | null } | null = null;
    if (lastSaleRes.data && lastSaleRes.data.length > 0) {
      lastPurchase = { date: lastSaleRes.data[0].created_at as string };
    }

    let topSid: string | undefined;
    if (suppliersRes.data && suppliersRes.data.length > 0) {
      const countBySupplier: Record<string, number> = {};
      for (const po of suppliersRes.data) {
        const sid = po.supplier_id as string;
        countBySupplier[sid] = (countBySupplier[sid] || 0) + 1;
      }
      topSid = Object.entries(countBySupplier).sort((a, b) => b[1] - a[1])[0]?.[0];
    }

    const [prodRes, custRes, suppRes] = await Promise.all([
      topPid ? supabaseAdmin.from('products').select('name').eq('id', topPid).maybeSingle() : Promise.resolve({ data: null }),
      topCid ? supabaseAdmin.from('customers').select('name').eq('id', topCid).maybeSingle() : Promise.resolve({ data: null }),
      topSid ? supabaseAdmin.from('suppliers').select('name').eq('id', topSid).maybeSingle() : Promise.resolve({ data: null }),
    ]);

    const topProduct = topPid ? { name: prodRes.data?.name || '—', qty: topProductQty } : null;
    const topCustomer = topCid ? { name: custRes.data?.name || '—', total: topCustomerTotal } : null;
    const topSupplier = topSid ? { name: suppRes.data?.name || '—' } : null;

    return NextResponse.json(fixResponse({
      topProduct,
      topCustomer,
      lastPurchase,
      topSupplier,
    }));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error processing summary';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
