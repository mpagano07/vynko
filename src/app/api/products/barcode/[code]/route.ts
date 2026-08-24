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
    if (error) { console.error('DB error:', error); return NextResponse.json({ error: 'Ocurrio un error inesperado. Intenta de nuevo.' }, { status: 500 }); }
    if (!data) {
      const result = await lookupById();
      data = result.data;
      error = result.error;
      if (error) { console.error('DB error:', error); return NextResponse.json({ error: 'Ocurrio un error inesperado. Intenta de nuevo.' }, { status: 500 }); }
    }

    if (!data) {
      return NextResponse.json({ product: null });
    }

    const { data: stockData } = await supabaseAdmin
      .from('product_stock')
      .select('stock, min_stock, max_stock, active')
      .eq('product_id', data.id)
      .eq('tenant_id', auth.tenantId)
      .maybeSingle();

    if (stockData && stockData.active === false) {
      return NextResponse.json({ product: null });
    }

    return NextResponse.json({
      product: {
        ...data,
        price: data.price_cents != null ? data.price_cents / 100 : 0,
        stock: stockData?.stock ?? 0,
        min_stock: stockData?.min_stock ?? 0,
        max_stock: stockData?.max_stock ?? 0,
      },
    });
  } catch (err) {
    console.error('Error in barcode lookup:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
