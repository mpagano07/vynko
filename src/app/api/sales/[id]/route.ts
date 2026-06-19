import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

async function getAuthenticatedTenant(): Promise<{ tenantId: string; userId: string } | null> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: tu } = await supabaseAdmin
    .from('tenant_users')
    .select('tenant_id')
    .eq('user_id', user.id);

  if (!tu || tu.length === 0) return null;
  return { tenantId: tu[0].tenant_id as string, userId: user.id };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthenticatedTenant();
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
