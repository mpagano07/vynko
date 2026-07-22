import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { createActivityLog } from '@/lib/activity-log';

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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getAuthenticatedUser();
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { id: purchaseOrderId } = await params;

  try {
    const body = await request.json();
    const { received_date, warehouse, notes, items } = body as {
      received_date?: string;
      warehouse?: string;
      notes?: string;
      items: { product_id: string; quantity_received: number }[];
    };

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Debe haber al menos un producto' }, { status: 400 });
    }

    const { data: order, error: poError } = await supabaseAdmin
      .from('purchase_orders')
      .select('*, supplier:suppliers(name)')
      .eq('id', purchaseOrderId)
      .eq('tenant_id', auth.tenantId)
      .single();

    if (poError || !order) {
      return NextResponse.json({ error: 'Pedido no encontrado' }, { status: 404 });
    }

    const supplier = (order as any).supplier as Record<string, unknown> | undefined;
    const supplierName = supplier?.name as string || 'Proveedor';

    const { data: seqResult } = await supabaseAdmin
      .from('commercial_document_sequences')
      .select('next_number')
      .eq('tenant_id', auth.tenantId)
      .eq('document_type', 'remito_ingreso')
      .single();

    let nextNumber = 1;
    if (seqResult) {
      nextNumber = seqResult.next_number as number;
    } else {
      await supabaseAdmin
        .from('commercial_document_sequences')
        .insert({
          tenant_id: auth.tenantId,
          document_type: 'remito_ingreso',
          next_number: 1,
        });
    }

    const { data: poItems } = await supabaseAdmin
      .from('purchase_order_items')
      .select('*, product:products(id, name, stock)')
      .eq('purchase_order_id', purchaseOrderId);

    if (!poItems || poItems.length === 0) {
      return NextResponse.json({ error: 'El pedido no tiene productos' }, { status: 400 });
    }

    // 1. Build remito items with what's being received now
    const remitoItems = poItems.map((item: Record<string, unknown>) => {
      const product = item.product as Record<string, unknown> | undefined;
      const productId = item.product_id as string;
      const productName = product?.name as string || 'Producto';
      const unitCostCents = Number(item.unit_cost_cents) || 0;

      const receivedItem = items.find((i: { product_id: string }) => i.product_id === productId);
      const qtyReceivingNow = receivedItem?.quantity_received || 0;

      return {
        product_id: productId,
        description: productName,
        quantity: qtyReceivingNow,
        unit_price_cents: unitCostCents,
      };
    });

    const totalCents = remitoItems.reduce((sum, item) => sum + item.unit_price_cents * item.quantity, 0);

    // 2. Create remito_ingreso
    const { data: document, error: docError } = await supabaseAdmin
      .from('commercial_documents')
      .insert({
        tenant_id: auth.tenantId,
        document_type: 'remito_ingreso',
        document_number: nextNumber,
        purchase_order_id: purchaseOrderId,
        customer_name: supplierName,
        supplier_name: supplierName,
        notes: notes || null,
        total_cents: totalCents,
        status: 'completed',
        delivery_date: received_date || new Date().toISOString().split('T')[0],
        created_by: auth.userId,
      })
      .select()
      .single();

    if (docError) {
      return NextResponse.json({ error: docError.message }, { status: 400 });
    }

    const documentItems = remitoItems.map(item => ({
      document_id: document.id,
      product_id: item.product_id,
      description: item.description,
      quantity: item.quantity,
      unit_price_cents: item.unit_price_cents,
      subtotal_cents: item.unit_price_cents * item.quantity,
    }));

    const { error: itemsError } = await supabaseAdmin
      .from('commercial_document_items')
      .insert(documentItems);

    if (itemsError) {
      await supabaseAdmin.from('commercial_documents').delete().eq('id', document.id);
      return NextResponse.json({ error: itemsError.message }, { status: 400 });
    }

    await supabaseAdmin
      .from('commercial_document_sequences')
      .update({ next_number: nextNumber + 1, updated_at: new Date().toISOString() })
      .eq('tenant_id', auth.tenantId)
      .eq('document_type', 'remito_ingreso');

    // 3. Update stock and increment quantity_received in PO items
    let allFullyReceived = true;

    for (const item of (poItems as Record<string, unknown>[])) {
      const product = item.product as Record<string, unknown> | undefined;
      const productId = item.product_id as string;
      const orderedQty = Number(item.quantity_ordered) || 0;
      const currentQtyReceived = Number(item.quantity_received) || 0;

      const receivedItem = items.find((i: { product_id: string }) => i.product_id === productId);
      const qtyReceivingNow = receivedItem?.quantity_received || 0;

      if (qtyReceivingNow > 0) {
        const newQtyReceived = currentQtyReceived + qtyReceivingNow;

        await supabaseAdmin
          .from('purchase_order_items')
          .update({ quantity_received: newQtyReceived })
          .eq('id', item.id);

        const currentStock = Number((product as Record<string, unknown>).stock) || 0;

        await supabaseAdmin
          .from('products')
          .update({ stock: currentStock + qtyReceivingNow, updated_at: new Date().toISOString() })
          .eq('id', productId);

        await supabaseAdmin
          .from('stock_history')
          .insert({
            tenant_id: auth.tenantId,
            product_id: productId,
            quantity: qtyReceivingNow,
            type: 'in',
            reason: `Recepción PO #${purchaseOrderId.slice(0, 8)}`,
            created_by: auth.userId,
          });
      }

      if (currentQtyReceived + qtyReceivingNow < orderedQty) {
        allFullyReceived = false;
      }
    }

    // 4. Update PO status based on whether all items are fully received
    const newStatus = allFullyReceived ? 'received' : 'partial';

    const { error: updateError } = await supabaseAdmin
      .from('purchase_orders')
      .update({
        status: newStatus,
        received_date: allFullyReceived ? (received_date || new Date().toISOString().split('T')[0]) : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', purchaseOrderId)
      .eq('tenant_id', auth.tenantId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 });
    }

    await createActivityLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: allFullyReceived ? 'received' : 'partial_receive',
      entityType: 'purchase_order',
      entityId: purchaseOrderId,
      details: {
        folio: purchaseOrderId.slice(0, 8),
        remito_number: nextNumber,
        partial: !allFullyReceived,
      },
    });

    const { data: fullDocument } = await supabaseAdmin
      .from('commercial_documents')
      .select('*, items:commercial_document_items(*)')
      .eq('id', document.id)
      .single();

    return NextResponse.json(
      { ...fullDocument, po_status: newStatus },
      { status: 201 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error al recibir pedido';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}