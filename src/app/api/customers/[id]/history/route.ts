import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { createServerSupabaseClient } from '@/lib/supabase';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data: tu } = await supabaseAdmin
    .from('tenant_users')
    .select('tenant_id')
    .eq('user_id', user.id);
  if (!tu || tu.length === 0) return NextResponse.json({ error: 'No tenant' }, { status: 401 });

  const { data: sales, error } = await supabaseAdmin
    .from('sales')
    .select(`
      id, total_cents, status, notes, created_at,
      items:sale_items(
        id, quantity, unit_price_cents, subtotal_cents,
        product:products(name)
      )
    `)
    .eq('tenant_id', tu[0].tenant_id)
    .eq('customer_id', id)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const totalSpent = (sales ?? []).reduce((sum, s: any) => sum + (s.total_cents || 0), 0);
  const visitCount = (sales ?? []).length;

  const formatted = (sales ?? []).map((s: any) => ({
    ...s,
    total: (s.total_cents || 0) / 100,
    items: (s.items || []).map((i: any) => ({
      ...i,
      unit_price: (i.unit_price_cents || 0) / 100,
      subtotal: (i.subtotal_cents || 0) / 100,
      product_name: i.product?.name || 'Producto',
    })),
  }));

  return NextResponse.json({ sales: formatted, totalSpent: totalSpent / 100, visitCount });
}
