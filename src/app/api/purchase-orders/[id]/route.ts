import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { createNotification } from '@/lib/notifications';

async function getAuthenticatedUser(): Promise<{ tenantId: string; userId: string } | null> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: tu } = await supabaseAdmin
    .from('tenant_users')
    .select('tenant_id')
    .eq('user_id', user.id);

  if (!tu || tu.length === 0) return null;
  return { tenantId: tu[0].tenant_id as string, userId: user.id };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await getAuthenticatedUser();
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  try {
    const body = await request.json();
    const { status, received_date } = body as {
      status?: string;
      received_date?: string;
    };

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (status) {
      const validStatuses = ['draft', 'pending', 'received', 'cancelled'];
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

    if (poError) return NextResponse.json({ error: poError.message }, { status: 400 });

    if (status === 'received') {
      const { data: items } = await supabaseAdmin
        .from('purchase_order_items')
        .select('*, product:products(id, name, stock)')
        .eq('purchase_order_id', id);

      const supplierName = (order as any)?.provider_id || 'proveedor';

      let productNames: string[] = [];
      for (const item of (items as Record<string, unknown>[] | undefined) ?? []) {
        const product = item.product as Record<string, unknown> | undefined;
        const qty = Number(item.quantity_ordered) || 0;
        const productId = item.product_id as string;
        const productName = product?.name as string || 'Producto';

        if (product && qty > 0) {
          const currentStock = Number((product as Record<string, unknown>).stock) || 0;

          await supabaseAdmin
            .from('products')
            .update({ stock: currentStock + qty, updated_at: new Date().toISOString() })
            .eq('id', productId);

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

      await createNotification({
        tenantId: auth.tenantId,
        type: 'po_received',
        title: 'OC Recibida',
        message: `Orden de compra recibida con ${productNames.length} producto(s): ${productNames.join(', ')}`,
        data: { purchase_order_id: id, product_count: productNames.length },
      });
    }

    if (status === 'cancelled') {
      await createNotification({
        tenantId: auth.tenantId,
        type: 'po_cancelled',
        title: 'OC Cancelada',
        message: `La orden de compra #${id.slice(0, 8)} fue cancelada.`,
        data: { purchase_order_id: id },
      });
    }

    return NextResponse.json(order);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error al actualizar pedido';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
