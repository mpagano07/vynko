import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { checkAndNotifyStock } from '@/lib/notifications';

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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tenantId = await getAuthenticatedTenant();
  if (!tenantId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  try {
    const body = await request.json();
    const allowedFields = [
      'category_id', 'sku', 'barcode', 'name', 'description',
      'cost', 'stock', 'min_stock', 'max_stock', 'image_url', 'metadata',
    ];
    const updateData: Record<string, any> = {};
    if (body.price !== undefined) updateData.price_cents = Math.round(body.price * 100);
    for (const key of allowedFields) {
      if (body[key] !== undefined) updateData[key] = body[key];
    }
    updateData.updated_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from('products')
      .update(updateData)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (body.stock !== undefined || body.min_stock !== undefined) {
      await checkAndNotifyStock(tenantId, id);
    }

    return NextResponse.json({ ...data, price: (data as any).price_cents != null ? (data as any).price_cents / 100 : 0 });
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tenantId = await getAuthenticatedTenant();
  if (!tenantId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { error } = await supabaseAdmin
    .from('products')
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenantId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
