import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';

function getTenantId(request: Request): string | null {
  return request.headers.get('x-tenant-id');
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tenantId = getTenantId(request);
  if (!tenantId) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 401 });
  }

  try {
    const body = await request.json();
    
    // Pick fields to update to avoid setting restricted columns (like tenant_id)
    const updateData: Record<string, any> = {};
    const allowedFields = [
      'category_id',
      'sku',
      'barcode',
      'name',
      'description',
      'price',
      'cost',
      'stock',
      'min_stock',
      'max_stock',
      'image_url',
      'metadata',
    ];

    for (const key of allowedFields) {
      if (body[key] !== undefined) {
        updateData[key] = body[key];
      }
    }

    updateData.updated_at = new Date().toISOString();

    const supabaseClient = await createServerSupabaseClient();
    const { data, error } = await supabaseClient
      .from('products')
      .update(updateData)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tenantId = getTenantId(request);
  if (!tenantId) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 401 });
  }

  const supabaseClient = await createServerSupabaseClient();
  const { error } = await supabaseClient
    .from('products')
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenantId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
