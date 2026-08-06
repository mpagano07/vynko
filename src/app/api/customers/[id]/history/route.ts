import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data: sales, error } = await supabaseAdmin
    .from('sales')
    .select(`
      id, total_cents, status, notes, created_at,
      items:sale_items(
        id, quantity, unit_price_cents, subtotal_cents,
        product:products(name)
      )
    `)
    .eq('tenant_id', auth.tenantId)
    .eq('customer_id', id)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const totalSpent = (sales ?? []).reduce((sum, s) => sum + (s.total_cents || 0), 0);
  const visitCount = (sales ?? []).length;

  const formatted = (sales ?? []).map((s) => ({
    ...s,
    total: (s.total_cents || 0) / 100,
    items: (s.items || []).map((i) => {
      const product = Array.isArray(i.product)
        ? (i.product[0] as Record<string, unknown> | undefined)
        : (i.product as unknown as Record<string, unknown> | undefined);
      return {
        ...i,
        unit_price: (i.unit_price_cents || 0) / 100,
        subtotal: (i.subtotal_cents || 0) / 100,
        product_name: product?.name || 'Producto',
      };
    }),
  }));

  return NextResponse.json({ sales: formatted, totalSpent: totalSpent / 100, visitCount });
}
