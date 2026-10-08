import { supabaseAdmin } from '@/lib/supabaseAdmin';
import type { AuthInfo } from '@/lib/api-auth';
import { logger } from '@/lib/logger';

export type StockHistoryResult<T = unknown> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: string; status: number };

export async function getStockHistory(
  auth: AuthInfo,
  options: { limit?: string | null; offset?: string | null; type?: string | null; product_id?: string | null; days?: string | null }
): Promise<StockHistoryResult> {
  const limit = Math.min(Number(options.limit) || 100, 500);
  const offset = Number(options.offset) || 0;
  const type = options.type;
  const productId = options.product_id;
  const days = Number(options.days) || 30;

  const since = new Date();
  since.setDate(since.getDate() - days);

  let query = supabaseAdmin
    .from('stock_history')
    .select(`
      *,
      product:products(name, sku)
    `, { count: 'exact' })
    .eq('tenant_id', auth.tenantId)
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (type) query = query.eq('type', type);
  if (productId) query = query.eq('product_id', productId);

  const { data, error, count } = await query;
  if (error) {
    logger.error('stock-history GET error:', { error: JSON.stringify(error) });
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
  }

  // Fetch profile names separately (no FK between stock_history and profiles)
  const userIds = [...new Set((data || []).map((r) => r.created_by))];
  const { data: profiles } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name')
    .in('id', userIds);
  const profileMap = new Map((profiles || []).map((p) => [p.id, p.full_name]));

  const formatted = (data || []).map((r) => ({
    id: r.id,
    productId: r.product_id,
    productName: r.product?.name || 'Producto',
    productSku: r.product?.sku || null,
    quantity: r.quantity,
    type: r.type,
    reason: r.reason,
    createdBy: profileMap.get(r.created_by) || 'Sistema',
    createdAt: r.created_at,
  }));

  return { ok: true, data: { items: formatted, total: count }, status: 200 };
}
