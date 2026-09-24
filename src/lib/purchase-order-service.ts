import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { createActivityLog } from '@/lib/activity-log';
import type { AuthInfo } from '@/lib/api-auth';

export type PurchaseOrderResult<T = unknown> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: string; status: number };

export async function listPurchaseOrders(
  auth: AuthInfo,
  supplierId: string | null
): Promise<PurchaseOrderResult> {
  let query = supabaseAdmin
    .from('purchase_orders')
    .select(`
      *,
      supplier:suppliers(name),
      items:purchase_order_items(
        *,
        product:products(name)
      )
    `)
    .eq('tenant_id', auth.tenantId);

  if (supplierId) {
    query = query.eq('supplier_id', supplierId);
  }

  query = query.order('created_at', { ascending: false });

  const { data: orders } = await query;

  const result = (orders ?? []).map((o: Record<string, unknown>) => {
    const supplier = o.supplier as Record<string, unknown> | undefined;
    const items = (o.items as Record<string, unknown>[] | undefined) ?? [];
    return {
      ...o,
      supplier_name: supplier?.name ?? null,
      items: items.map((i: Record<string, unknown>) => {
        const product = i.product as Record<string, unknown> | undefined;
        return {
          ...i,
          product_name: product?.name ?? null,
        };
      }),
    };
  });

  return { ok: true, data: result, status: 200 };
}

interface CreatePurchaseOrderBody {
  supplier_id?: string;
  expected_date?: string;
  notes?: string;
  status?: string;
  items: { product_id: string; quantity: number; unit_cost?: number }[];
}

export async function createPurchaseOrder(
  auth: AuthInfo,
  body: CreatePurchaseOrderBody
): Promise<PurchaseOrderResult> {
  try {
    const { supplier_id, expected_date, notes, status, items } = body;

    if (!supplier_id) {
      return { ok: false, error: 'Debes seleccionar un proveedor', status: 400 };
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return { ok: false, error: 'El pedido debe tener al menos un producto', status: 400 };
    }

    const productIds = items.map((i) => i.product_id);
    const { data: products, error: prodError } = await supabaseAdmin
      .from('products')
      .select('id, name, cost, cost_cents')
      .in('id', productIds);

    if (prodError) {
      console.error('DB error:', prodError);
      return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
    }

    type ProductRow = { id: string; name: string; cost: number; cost_cents?: number };
    const productMap = new Map((products ?? []).map((p) => [p.id, p as unknown as ProductRow]));

    const poItems = items.map((item) => {
      const product = productMap.get(item.product_id);
      if (!product) throw new Error(`Producto no encontrado: ${item.product_id}`);

      const quantity = Number(item.quantity) || 1;
      const unit_cost_cents = item.unit_cost != null
        ? Math.round(Number(item.unit_cost) * 100)
        : (product.cost_cents ?? Math.round(Number(product.cost) * 100));

      return { product_id: item.product_id, quantity_ordered: quantity, quantity_received: 0, unit_cost_cents };
    });

    const total_cents = poItems.reduce((sum, item) => sum + item.quantity_ordered * item.unit_cost_cents, 0);

    const { data: existingProvider } = await supabaseAdmin
      .from('providers')
      .select('id')
      .eq('id', supplier_id)
      .eq('tenant_id', auth.tenantId);

    if (!existingProvider || existingProvider.length === 0) {
      const { data: supplier } = await supabaseAdmin
        .from('suppliers')
        .select('name, email, phone, address')
        .eq('id', supplier_id)
        .eq('tenant_id', auth.tenantId);

      const sup = (supplier as Record<string, unknown>[] | null)?.[0];
      await supabaseAdmin
        .from('providers')
        .insert({
          id: supplier_id,
          tenant_id: auth.tenantId,
          name: (sup?.name as string) || 'Proveedor',
          email: (sup?.email as string) || null,
          phone: (sup?.phone as string) || null,
          address: (sup?.address as string) || null,
        });
    }

    const { data: order, error: poError } = await supabaseAdmin
      .from('purchase_orders')
      .insert({
        tenant_id: auth.tenantId,
        supplier_id,
        provider_id: supplier_id,
        total_cents,
        status: status || 'draft',
        expected_date: expected_date || null,
        notes: notes || null,
        created_by: auth.userId,
      })
      .select()
      .single();

    if (poError) {
      console.error('DB error:', poError);
      return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 400 };
    }

    const { error: itemsError } = await supabaseAdmin
      .from('purchase_order_items')
      .insert(
        poItems.map((item) => ({
          purchase_order_id: order.id,
          product_id: item.product_id,
          quantity_ordered: item.quantity_ordered,
          quantity_received: 0,
          unit_cost_cents: item.unit_cost_cents,
        }))
      );

    if (itemsError) {
      await supabaseAdmin.from('purchase_orders').delete().eq('id', order.id);
      console.error('DB error:', itemsError);
      return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 400 };
    }

    await createActivityLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: 'created',
      entityType: 'purchase_order',
      entityId: order.id,
      details: { folio: order.id.slice(0, 8), supplier_id, total_cents, items_count: items.length },
    });

    return { ok: true, data: order, status: 201 };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error al crear el pedido';
    return { ok: false, error: message, status: 400 };
  }
}

export async function updatePurchaseOrder(
  auth: AuthInfo,
  id: string,
  body: { status?: string; received_date?: string }
): Promise<PurchaseOrderResult> {
  try {
    const { status, received_date } = body;

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (status) {
      const validStatuses = ['draft', 'sent', 'partial', 'received', 'cancelled'];
      if (!validStatuses.includes(status)) {
        return { ok: false, error: 'Estado inválido', status: 400 };
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

    if (poError) {
      console.error('DB error:', poError);
      return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 400 };
    }

    if (status === 'received') {
      const { data: items } = await supabaseAdmin
        .from('purchase_order_items')
        .select('*, product:products(id, name)')
        .eq('purchase_order_id', id);

      for (const item of (items as Record<string, unknown>[] | undefined) ?? []) {
        const product = item.product as Record<string, unknown> | undefined;
        const qty = Number(item.quantity_ordered) || 0;
        const productId = item.product_id as string;

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
            .upsert(
              {
                product_id: productId,
                tenant_id: auth.tenantId,
                stock: currentStock + qty,
                updated_at: new Date().toISOString(),
              },
              { onConflict: 'product_id,tenant_id' }
            );

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

    return { ok: true, data: order, status: 200 };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error al actualizar pedido';
    return { ok: false, error: message, status: 400 };
  }
}

export async function listPendingPurchaseOrders(auth: AuthInfo): Promise<PurchaseOrderResult> {
  const { data: orders, error } = await supabaseAdmin
    .from('purchase_orders')
    .select(`
      id,
      status,
      expected_date,
      created_at,
      supplier:suppliers(name),
      items:purchase_order_items(
        quantity_ordered,
        quantity_received,
        product:products(id, name)
      )
    `)
    .eq('tenant_id', auth.tenantId)
    .in('status', ['draft', 'sent', 'partial'])
    .order('created_at', { ascending: false });

  if (error) {
    console.error('DB error:', error);
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
  }

  const result = (orders ?? [])
    .map((o: Record<string, unknown>) => {
      const supplier = o.supplier as Record<string, unknown> | undefined;
      const items = ((o.items as Record<string, unknown>[] | undefined) ?? [])
        .map((i: Record<string, unknown>) => {
          const product = i.product as Record<string, unknown> | undefined;
          const ordered = Number(i.quantity_ordered) || 0;
          const received = Number(i.quantity_received) || 0;
          return {
            product_id: (product?.id as string) ?? null,
            product_name: (product?.name as string) ?? 'Producto',
            quantity_ordered: ordered,
            quantity_received: received,
            quantity_pending: Math.max(0, ordered - received),
          };
        })
        .filter((i) => i.quantity_pending > 0);

      return {
        id: o.id,
        status: o.status,
        expected_date: (o.expected_date as string | null) ?? null,
        created_at: o.created_at,
        supplier_name: (supplier?.name as string) ?? 'Proveedor',
        items,
      };
    })
    .filter((o) => o.items.length > 0);

  return { ok: true, data: result, status: 200 };
}

export type ReceivePurchaseOrderResult =
  | { ok: true; data: Record<string, unknown>; status: 201 }
  | { ok: false; error: string; status: number };

interface ReceiveBody {
  received_date?: string;
  deposito?: string;
  pasillo?: string;
  estanteria?: string;
  notes?: string;
  items: { product_id: string; quantity_received: number }[];
}

export async function receivePurchaseOrder(
  auth: AuthInfo,
  purchaseOrderId: string,
  body: ReceiveBody
): Promise<ReceivePurchaseOrderResult> {
  const { received_date, deposito, pasillo, estanteria, notes, items } = body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return { ok: false, error: 'Debe haber al menos un producto', status: 400 };
  }

  const { data: order, error: poError } = await supabaseAdmin
    .from('purchase_orders')
    .select('*, supplier:suppliers(name)')
    .eq('id', purchaseOrderId)
    .eq('tenant_id', auth.tenantId)
    .single();

  if (poError || !order) {
    return { ok: false, error: 'Pedido no encontrado', status: 404 };
  }

  const supplier = order.supplier as Record<string, unknown> | undefined;
  const supplierName = (supplier?.name as string) || 'Proveedor';

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
    .select('*, product:products(id, name)')
    .eq('purchase_order_id', purchaseOrderId);

  if (!poItems || poItems.length === 0) {
    return { ok: false, error: 'El pedido no tiene productos', status: 400 };
  }

  const remitoItems = poItems.map((item: Record<string, unknown>) => {
    const product = item.product as Record<string, unknown> | undefined;
    const productId = item.product_id as string;
    const productName = (product?.name as string) || 'Producto';
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
    console.error('DB error:', docError);
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 400 };
  }

  const documentItems = remitoItems.map((item) => ({
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
    console.error('DB error:', itemsError);
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 400 };
  }

  await supabaseAdmin
    .from('commercial_document_sequences')
    .update({ next_number: nextNumber + 1, updated_at: new Date().toISOString() })
    .eq('tenant_id', auth.tenantId)
    .eq('document_type', 'remito_ingreso');

  let allFullyReceived = true;

  for (const item of poItems as Record<string, unknown>[]) {
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

      const { data: stockRow } = await supabaseAdmin
        .from('product_stock')
        .select('stock')
        .eq('product_id', productId)
        .eq('tenant_id', auth.tenantId)
        .maybeSingle();

      const currentStock = Number((stockRow as Record<string, unknown> | null)?.stock) || 0;

      const stockUpdate: Record<string, unknown> = {
        product_id: productId,
        tenant_id: auth.tenantId,
        stock: currentStock + qtyReceivingNow,
        updated_at: new Date().toISOString(),
      };
      if (deposito !== undefined) stockUpdate.deposito = deposito;
      if (pasillo !== undefined) stockUpdate.pasillo = pasillo;
      if (estanteria !== undefined) stockUpdate.estanteria = estanteria;

      await supabaseAdmin
        .from('product_stock')
        .upsert(stockUpdate, { onConflict: 'product_id,tenant_id' });

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
    console.error('DB error:', updateError);
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 400 };
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

  return {
    ok: true,
    status: 201,
    data: { ...fullDocument, po_status: newStatus },
  };
}