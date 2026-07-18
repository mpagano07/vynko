import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { createServerSupabaseClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data: tu } = await supabaseAdmin
    .from('tenant_users')
    .select('tenant_id')
    .eq('user_id', user.id);
  if (!tu || tu.length === 0) return NextResponse.json({ error: 'No tenant' }, { status: 401 });
  const tenantId = tu[0].tenant_id;

  const [salesIdsRes, customersRes, purchaseRes, suppliersRes] = await Promise.all([
    supabaseAdmin.from('sales').select('id').eq('tenant_id', tenantId),
    supabaseAdmin
      .from('sales')
      .select('customer_id, total_cents')
      .eq('tenant_id', tenantId)
      .not('customer_id', 'is', null),
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
      .not('supplier_id', 'is', null),
  ]);

  const saleIds = (salesIdsRes.data ?? []).map(s => s.id as string);

  const { data: saleItems } = saleIds.length > 0
    ? await supabaseAdmin
        .from('sale_items')
        .select('product_id, quantity')
        .in('sale_id', saleIds)
    : { data: [] };

  let topProduct: { name: string; qty: number } | null = null;
  if (saleItems && saleItems.length > 0) {
    const qtyByProduct: Record<string, number> = {};
    for (const item of saleItems) {
      const pid = item.product_id as string;
      qtyByProduct[pid] = (qtyByProduct[pid] || 0) + ((item.quantity as number) || 0);
    }
    const topPid = Object.entries(qtyByProduct).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (topPid) {
      const { data: prod } = await supabaseAdmin.from('products').select('name').eq('id', topPid).single();
      topProduct = { name: prod?.name || '—', qty: qtyByProduct[topPid] };
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
      const { data: cust } = await supabaseAdmin.from('customers').select('name').eq('id', topCid).single();
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
      const { data: supp } = await supabaseAdmin.from('suppliers').select('name').eq('id', topSid).single();
      topSupplier = { name: supp?.name || '—' };
    }
  }

  return NextResponse.json({
    topProduct,
    topCustomer,
    lastPurchase,
    topSupplier,
  });
}
