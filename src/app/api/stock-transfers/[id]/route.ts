import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { createActivityLog } from '@/lib/activity-log';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await request.json();
  const { status } = body;

  if (!status || !['pending', 'in_transit', 'received'].includes(status)) {
    return NextResponse.json({ error: 'Estado inválido' }, { status: 400 });
  }

  const { data: transfer, error: fetchError } = await supabaseAdmin
    .from('stock_transfers')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchError || !transfer) {
    return NextResponse.json({ error: 'Transferencia no encontrada' }, { status: 404 });
  }

  const userCanAccess = auth.allTenants || auth.tenantIds.includes(transfer.from_tenant_id) || auth.tenantIds.includes(transfer.to_tenant_id);
  if (!userCanAccess) {
    return NextResponse.json({ error: 'No tienes permisos sobre esta transferencia' }, { status: 403 });
  }

  if (transfer.status === 'received') {
    return NextResponse.json({ error: 'La transferencia ya fue recibida' }, { status: 400 });
  }

  if (status === 'in_transit' && transfer.status !== 'pending') {
    return NextResponse.json({ error: 'Solo se puede enviar una transferencia pendiente' }, { status: 400 });
  }

  if (status === 'received' && transfer.status !== 'in_transit') {
    return NextResponse.json({ error: 'La transferencia debe estar en tránsito para recibirse' }, { status: 400 });
  }

  const { data: items, error: itemsError } = await supabaseAdmin
    .from('stock_transfer_items')
    .select('*, product:products(name)')
    .eq('transfer_id', id);

  if (itemsError || !items) {
    return NextResponse.json({ error: 'Error al obtener items' }, { status: 500 });
  }

  if (status === 'in_transit') {
    for (const item of items) {
      const { data: stock } = await supabaseAdmin
        .from('product_stock')
        .select('stock')
        .eq('product_id', item.product_id)
        .eq('tenant_id', transfer.from_tenant_id)
        .single();

      const currentStock = stock?.stock ?? 0;
      if (currentStock < item.quantity) {
        const itemWithProduct = item as { product?: { name?: string } };
        const productName = itemWithProduct.product?.name || 'Producto';
        return NextResponse.json({
          error: `Stock insuficiente de "${productName}" en origen. Disponible: ${currentStock}, requerido: ${item.quantity}`,
        }, { status: 400 });
      }
    }

    for (const item of items) {
      const { data: stock } = await supabaseAdmin
        .from('product_stock')
        .select('stock')
        .eq('product_id', item.product_id)
        .eq('tenant_id', transfer.from_tenant_id)
        .single();

      const currentStock = stock?.stock ?? 0;

      await supabaseAdmin
        .from('product_stock')
        .update({ stock: currentStock - item.quantity, updated_at: new Date().toISOString() })
        .eq('product_id', item.product_id)
        .eq('tenant_id', transfer.from_tenant_id);

      await supabaseAdmin
        .from('stock_history')
        .insert({
          tenant_id: transfer.from_tenant_id,
          product_id: item.product_id,
          quantity: -item.quantity,
          type: 'transfer',
          reason: `Transferencia a ${transfer.to_tenant_id}`,
          created_by: auth.userId,
        });
    }
  }

  if (status === 'received') {
    for (const item of items) {
      const { data: stock } = await supabaseAdmin
        .from('product_stock')
        .select('stock')
        .eq('product_id', item.product_id)
        .eq('tenant_id', transfer.to_tenant_id)
        .single();

      const currentStock = stock?.stock ?? 0;

      await supabaseAdmin
        .from('product_stock')
        .upsert({
          product_id: item.product_id,
          tenant_id: transfer.to_tenant_id,
          stock: currentStock + item.quantity,
          min_stock: 0,
          max_stock: 0,
        }, { onConflict: 'product_id,tenant_id' });

      await supabaseAdmin
        .from('stock_history')
        .insert({
          tenant_id: transfer.to_tenant_id,
          product_id: item.product_id,
          quantity: item.quantity,
          type: 'transfer',
          reason: `Transferencia desde ${transfer.from_tenant_id}`,
          created_by: auth.userId,
        });
    }
  }

  const updateData: Record<string, string | undefined> = {
    status,
    updated_at: new Date().toISOString(),
  };

  if (status === 'received') {
    updateData.received_at = new Date().toISOString();
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('stock_transfers')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();

  if (updateError) {
    { console.error('DB error:', updateError); return NextResponse.json({ error: 'Ocurrio un error inesperado. Intenta de nuevo.' }, { status: 500 }); }
  }

  await createActivityLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: status === 'in_transit' ? 'sent' : 'received',
    entityType: 'stock_transfer',
    entityId: id,
    details: { status, from_tenant_id: transfer.from_tenant_id, to_tenant_id: transfer.to_tenant_id },
  });

  return NextResponse.json(updated);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data: transfer, error: fetchError } = await supabaseAdmin
    .from('stock_transfers')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchError || !transfer) {
    return NextResponse.json({ error: 'Transferencia no encontrada' }, { status: 404 });
  }

  if (transfer.status !== 'pending') {
    return NextResponse.json({ error: 'Solo se pueden cancelar transferencias pendientes de envío' }, { status: 400 });
  }

  if (!auth.allTenants && transfer.from_tenant_id !== auth.tenantId && transfer.to_tenant_id !== auth.tenantId) {
    return NextResponse.json({ error: 'No tienes permisos sobre esta transferencia' }, { status: 403 });
  }

  const { error: deleteError } = await supabaseAdmin
    .from('stock_transfers')
    .delete()
    .eq('id', id);

  if (deleteError) {
    { console.error('DB error:', deleteError); return NextResponse.json({ error: 'Ocurrio un error inesperado. Intenta de nuevo.' }, { status: 500 }); }
  }

  await createActivityLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: 'deleted',
    entityType: 'stock_transfer',
    entityId: id,
    details: { from_tenant_id: transfer.from_tenant_id, to_tenant_id: transfer.to_tenant_id },
  });

  return NextResponse.json({ success: true });
}
