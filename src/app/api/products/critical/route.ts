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
        stock_data:product_stock!inner(stock, min_stock)
      `);
    if (!auth.allTenants) productsQuery = productsQuery.eq('product_stock.tenant_id', tenantId);
    productsQuery = productsQuery.eq('product_stock.active', true);
    const { data: products, error } = await productsQuery;

    if (error) { console.error('DB error:', error); return NextResponse.json({ error: 'Ocurrio un error inesperado. Intenta de nuevo.' }, { status: 500 }); }

    const critical = (products ?? []).filter((p) => {
      const s = p.stock_data?.[0];
      if (!s) return false;
      const stock = Number(s.stock) || 0;
      const minStock = Number(s.min_stock) || 0;
      return stock <= minStock;
    }).map((p) => ({
      id: p.id,
      name: p.name,
      stock: Number(p.stock_data?.[0]?.stock) || 0,
      min_stock: Number(p.stock_data?.[0]?.min_stock) || 0,
    }));

    return NextResponse.json(critical);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error in critical products';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
