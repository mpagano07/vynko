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

  const { data: products, error } = await supabaseAdmin
    .from('products')
    .select('id, name, stock, min_stock')
    .eq('tenant_id', tenantId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const critical = (products ?? []).filter(p => {
    const stock = (p.stock as number) ?? 0;
    const minStock = (p.min_stock as number) ?? 0;
    return stock <= minStock;
  });

  return NextResponse.json(critical);
}
