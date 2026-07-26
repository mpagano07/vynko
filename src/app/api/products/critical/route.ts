import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const auth = await getAuth(request);
    if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    const tenantId = auth.tenantId;

    let productsQuery = supabaseAdmin
      .from('products')
      .select(`
        id, name,
        stock_data:product_stock(stock, min_stock)
      `);
    if (!auth.allTenants) productsQuery = productsQuery.eq('product_stock.tenant_id', tenantId);
    const { data: products, error } = await productsQuery;

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const critical = (products ?? []).filter(p => {
      const s = (p as any).stock_data?.[0];
      if (!s) return false;
      const stock = (s?.stock as number) ?? 0;
      const minStock = (s?.min_stock as number) ?? 0;
      return stock <= minStock;
    }).map(p => ({
      id: p.id,
      name: p.name,
      stock: (p as any).stock_data?.[0]?.stock ?? 0,
      min_stock: (p as any).stock_data?.[0]?.min_stock ?? 0,
    }));

    return NextResponse.json(critical);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error in critical products';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
