import { supabaseAdmin } from '@/lib/supabaseAdmin';
import type { AuthInfo } from '@/lib/api-auth';
import { getCriticalVariants } from '@/lib/variant-service';
import { sellableDisplayName } from '@/lib/types/variant';

export type DashboardSummaryResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string };

export type DashboardVariantsResult =
  | { ok: true; data: Array<Record<string, unknown>> }
  | { ok: false; error: string };

/** Críticos por variante: el service ya aplica el scope y el display name. */
export async function getDashboardVariantSummary(auth: AuthInfo): Promise<DashboardVariantsResult> {
  const result = await getCriticalVariants(auth);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, data: result.data };
}

export async function getDashboardSummary(auth: AuthInfo): Promise<DashboardSummaryResult> {
  try {
    const tenantId = auth.tenantId;

    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const allTenantsBool = auth.allTenants;
    const authorizedTenantIds = auth.tenantIds;

    function qFilter<T extends { eq: (col: string, value: string) => unknown; in: (col: string, values: string[]) => unknown }>(q: T): T {
      return allTenantsBool ? (q.in('tenant_id', authorizedTenantIds) as T) : (q.eq('tenant_id', tenantId) as T);
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

    const saleIds = ((recentSalesRes.data ?? []) as { id: string }[]).map((s) => s.id);

    let topPid: string | undefined;
    let topVariantLabel: string | null = null;
    let topProductQty = 0;
    if (saleIds.length > 0) {
      const { data: saleItems } = await supabaseAdmin
        .from('sale_items')
        .select('product_id, variant_id, quantity')
        .in('sale_id', saleIds);

      if (saleItems && saleItems.length > 0) {
        // Un producto con variantes vende varias unidades comerciales distintas:
        // agrupar solo por product_id las mezclaba en un mismo "top producto".
        const qtyBySellable: Record<string, number> = {};
        for (const item of saleItems) {
          const key = `${String(item.product_id ?? '')}|${String(item.variant_id ?? '')}`;
          qtyBySellable[key] = (qtyBySellable[key] || 0) + ((item.quantity as number) || 0);
        }
        const topKey = Object.entries(qtyBySellable).sort((a, b) => b[1] - a[1])[0]?.[0];
        if (topKey) {
          const [productId, variantId] = topKey.split('|');
          topPid = productId || undefined;
          topProductQty = qtyBySellable[topKey];
          if (variantId) {
            const { data: variant } = await supabaseAdmin
              .from('product_variants')
              .select('product_id, label')
              .eq('id', variantId)
              .maybeSingle();
            if (variant?.product_id) topPid = String(variant.product_id);
            topVariantLabel = variant?.label ? String(variant.label) : null;
          }
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

    const topProduct = topPid
      ? { name: sellableDisplayName(String(prodRes.data?.name ?? '—'), topVariantLabel), qty: topProductQty }
      : null;
    const topCustomer = topCid ? { name: custRes.data?.name || '—', total: topCustomerTotal } : null;
    const topSupplier = topSid ? { name: suppRes.data?.name || '—' } : null;

    return {
      ok: true,
      data: { topProduct, topCustomer, lastPurchase, topSupplier },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error processing summary';
    return { ok: false, error: msg };
  }
}