import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { createActivityLog } from '@/lib/activity-log';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  try {
    const body = await request.json();
    const allowedFields = [
      'category_id', 'sku', 'barcode', 'name', 'description',
      'cost', 'image_url', 'metadata',
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
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Producto no encontrado o sin permisos' }, { status: 403 });
    }

    if (data && (body.stock !== undefined || body.min_stock !== undefined || body.max_stock !== undefined || body.deposito !== undefined || body.pasillo !== undefined || body.estanteria !== undefined)) {
      const stockUpdate: Record<string, any> = { updated_at: new Date().toISOString() };
      if (body.stock !== undefined) stockUpdate.stock = body.stock;
      if (body.min_stock !== undefined) stockUpdate.min_stock = body.min_stock;
      if (body.max_stock !== undefined) stockUpdate.max_stock = body.max_stock;
      if (body.deposito !== undefined) stockUpdate.deposito = body.deposito;
      if (body.pasillo !== undefined) stockUpdate.pasillo = body.pasillo;
      if (body.estanteria !== undefined) stockUpdate.estanteria = body.estanteria;

      const { error: stockError } = await supabaseAdmin
        .from('product_stock')
        .upsert({
          product_id: id,
          tenant_id: auth.tenantId,
          ...stockUpdate,
        }, { onConflict: 'product_id,tenant_id' });

      if (stockError) {
        return NextResponse.json({ error: stockError.message }, { status: 400 });
      }
    }

    await createActivityLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: 'updated',
      entityType: 'product',
      entityId: id,
      details: { name: data?.name },
    });

    const stockData = data ? await supabaseAdmin
      .from('product_stock')
      .select('stock, min_stock, max_stock, deposito, pasillo, estanteria')
      .eq('product_id', id)
      .eq('tenant_id', auth.tenantId)
      .maybeSingle() : null;

    return NextResponse.json({
      ...data,
      price: (data as any).price_cents != null ? (data as any).price_cents / 100 : 0,
      stock: (stockData?.data as any)?.stock ?? 0,
      min_stock: (stockData?.data as any)?.min_stock ?? 0,
      max_stock: (stockData?.data as any)?.max_stock ?? 0,
      deposito: (stockData?.data as any)?.deposito ?? null,
      pasillo: (stockData?.data as any)?.pasillo ?? null,
      estanteria: (stockData?.data as any)?.estanteria ?? null,
    });
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data: deleted } = await supabaseAdmin
    .from('products')
    .delete()
    .eq('id', id)
    .select('name')
    .single();

  if (!deleted) return NextResponse.json({ error: 'Producto no encontrado o sin permisos' }, { status: 403 });

  await createActivityLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: 'deleted',
    entityType: 'product',
    details: { name: (deleted as any).name },
  });

  return NextResponse.json({ success: true });
}
