import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

async function getAuthenticatedTenant(): Promise<string | null> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: tu } = await supabaseAdmin
    .from('tenant_users')
    .select('tenant_id')
    .eq('user_id', user.id);

  if (!tu || tu.length === 0) return null;
  return (tu as any)[0].tenant_id;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const tenantId = await getAuthenticatedTenant();
    if (!tenantId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { data, error } = await supabaseAdmin
      .from('products')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('barcode', code)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ product: null });
    }

    return NextResponse.json({
      product: {
        ...data,
        price: (data as any).price_cents != null ? (data as any).price_cents / 100 : 0,
      },
    });
  } catch (err) {
    console.error('Error in barcode lookup:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
