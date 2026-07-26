import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(request: NextRequest) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get('limit')) || 100, 500);
  const offset = Number(searchParams.get('offset')) || 0;
  const type = searchParams.get('type');
  const productId = searchParams.get('product_id');
  const days = Number(searchParams.get('days')) || 30;

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
    console.error('stock-history GET error:', JSON.stringify(error));
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Fetch profile names separately (no FK between stock_history and profiles)
  const userIds = [...new Set((data || []).map((r: any) => r.created_by))];
  const { data: profiles } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name')
    .in('id', userIds);
  const profileMap = new Map((profiles || []).map((p: any) => [p.id, p.full_name]));

  const formatted = (data || []).map((r: any) => ({
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

  return NextResponse.json({ items: formatted, total: count });
}
