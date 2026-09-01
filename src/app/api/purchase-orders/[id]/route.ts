import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { createActivityLog } from '@/lib/activity-log';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  try {
    const body = await request.json();
    const { status, received_date } = body as {
      status?: string;
      received_date?: string;
    };

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (status) {
      const validStatuses = ['draft', 'sent', 'partial', 'received', 'cancelled'];
      if (!validStatuses.includes(status)) {
        return NextResponse.json({ error: 'Estado inválido' }, { status: 400 });
      }
      updateData.status = status;

      if (status === 'received') {
        updateData.received_date = received_date || new Date().toISOString().split('T')[0];
      }
    }

    const { data: order, error: poError } = await supabaseAdmin
      .from('purchase_orders')
      .update(updateData)
      .eq('id', id)
      .eq('tenant_id', auth.tenantId)
      .select()
      .single();

    if (poError) { console.error('DB error:', poError); return NextResponse.json({ error: 'Ocurrio un error inesperado. Intenta de nuevo.' }, { status: 400 }); }

    if (status === 'received') {
      const { data: items } = await supabaseAdmin
        .from('purchase_order_items')
        .select('*, product:products(id, name)')
        .eq('purchase_order_id', id);

      const productNames: string[] = [];
      for (const item of (items as Record<string, unknown>[] | undefined) ?? []) {
        const product = item.product as Record<string, unknown> | undefined;
        const qty = Number(item.quantity_ordered) || 0;
        const productId = item.product_id as string;
        const productName = product?.name as string || 'Producto';

        if (product && qty > 0) {
          const { data: stockRow } = await supabaseAdmin
            .from('product_stock')
            .select('stock')
            .eq('product_id', productId)
            .eq('tenant_id', auth.tenantId)
            .maybeSingle();

          const currentStock = Number((stockRow as Record<string, unknown> | null)?.stock) || 0;

          await supabaseAdmin
            .from('product_stock')
            .upsert({
              product_id: productId,
              tenant_id: auth.tenantId,
              stock: currentStock + qty,
              updated_at: new Date().toISOString(),
            }, { onConflict: 'product_id,tenant_id' });

          await supabaseAdmin
            .from('stock_history')
            .insert({
              tenant_id: auth.tenantId,
              product_id: productId,
              quantity: qty,
              type: 'in',
              reason: `Recepción PO #${id.slice(0, 8)}`,
              created_by: auth.userId,
            });

          productNames.push(`${productName} (${qty} u.)`);
        }
      }

    }

    await createActivityLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: status === 'received' ? 'received' : 'cancelled',
      entityType: 'purchase_order',
      entityId: id,
      details: { folio: id.slice(0, 8) },
    });

    return NextResponse.json(order);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error al actualizar pedido';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}