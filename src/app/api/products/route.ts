import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import type { Product } from '@/lib/types/product';

/** Helper to extract tenant id from request headers */
function getTenantId(request: Request): string | null {
  const tenant = request.headers.get('x-tenant-id');
  return tenant;
}

export async function GET(request: Request) {
  const tenantId = getTenantId(request);
  if (!tenantId) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 401 });
  }

  const supabaseClient = await createServerSupabaseClient();
  const { data, error } = await supabaseClient
    .from('products')
    .select('*')
    .eq('tenant_id', tenantId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const tenantId = getTenantId(request);
  if (!tenantId) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 401 });
  }
  const body = await request.json();
  const product: Partial<Product> = {
    ...body,
    tenant_id: tenantId,
  };

  const supabaseClient = await createServerSupabaseClient();
  const { data, error } = await supabaseClient.from('products').insert(product).select();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json(data?.[0], { status: 201 });
}
