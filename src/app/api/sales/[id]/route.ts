import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { id } = await params;

  const { data: sale, error } = await supabaseAdmin
    .from('sales')
    .select(`
      *,
      items:sale_items(
        *,
        product:products(name)
      ),
      customer:customers(name)
    `)
    .eq('id', id)
    .eq('tenant_id', auth.tenantId)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });

  const s = sale as Record<string, unknown>;
  const customer = s.customer as Record<string, unknown> | undefined;
  const items = (s.items as Record<string, unknown>[] | undefined) ?? [];

  const result = {
    ...s,
    customer_name: customer?.name ?? null,
    items: items.map((i: Record<string, unknown>) => {
      const product = i.product as Record<string, unknown> | undefined;
      return {
        ...i,
        product_name: product?.name ?? null,
      };
    }),
  };

  return NextResponse.json(result);
}
