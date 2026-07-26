import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const auth = await getAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const lookupByBarcode = async () => {
      return supabaseAdmin
        .from('products')
        .select('*')
        .eq('barcode', code)
        .maybeSingle();
    };

    const lookupById = async () => {
      return supabaseAdmin
        .from('products')
        .select('*')
        .eq('id', code)
        .maybeSingle();
    };

    let { data, error } = await lookupByBarcode();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) {
      const result = await lookupById();
      data = result.data;
      error = result.error;
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ product: null });
    }

    const { data: stockData } = await supabaseAdmin
      .from('product_stock')
      .select('stock, min_stock, max_stock')
      .eq('product_id', data.id)
      .eq('tenant_id', auth.tenantId)
      .maybeSingle();

    return NextResponse.json({
      product: {
        ...data,
        price: (data as any).price_cents != null ? (data as any).price_cents / 100 : 0,
        stock: (stockData as any)?.stock ?? 0,
        min_stock: (stockData as any)?.min_stock ?? 0,
        max_stock: (stockData as any)?.max_stock ?? 0,
      },
    });
  } catch (err) {
    console.error('Error in barcode lookup:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
