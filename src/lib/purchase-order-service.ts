import { supabaseAdmin } from '@/lib/supabaseAdmin';
import {
  claimCommercialDocumentNumber,
  releaseCommercialDocumentNumber,
} from '@/lib/commercial-document-number';
import { createActivityLog } from '@/lib/activity-log';
import type { AuthInfo } from '@/lib/api-auth';
import { canManageTenant, getRoleInTenant } from '@/lib/membership-role';
import { trackEvent } from '@/lib/track-event';

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

    const role = await getRoleInTenant(auth.userId, auth.tenantId);
    if (!canManageTenant(role)) {
      return { ok: false, error: 'Solo el dueño o un administrador puede crear pedidos', status: 403 };
    }

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

      const rawQuantity = Number(item.quantity);
      if (!Number.isFinite(rawQuantity) || rawQuantity <= 0) {
        throw new Error(`Cantidad inválida para "${product.name}"`);
      }
      const quantity = rawQuantity;
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
      // `supplier_id` viene del body. Antes, si no habia proveedor en este
      // tenant se sembraba uno con el id que dictate el cliente: eso clavaba
      // el pedido de A al proveedor de B y, con el join sin filtro del
      // listado, llegaba el nombre de otra empresa a la pantalla de compras.
      // Si el proveedor no es de este tenant, el pedido no se crea.
      if (!sup) {
        return { ok: false, error: 'El proveedor no pertenece a esta sucursal', status: 400 };
      }
      await supabaseAdmin
        .from('providers')
        .insert({
          id: supplier_id,
          tenant_id: auth.tenantId,
          name: (sup.name as string) || 'Proveedor',
          email: (sup.email as string) || null,
          phone: (sup.phone as string) || null,
          address: (sup.address as string) || null,
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
  body: { status?: string }
): Promise<PurchaseOrderResult> {
  try {
    const { status } = body;

    const role = await getRoleInTenant(auth.userId, auth.tenantId);
    if (!canManageTenant(role)) {
      return { ok: false, error: 'Solo el dueño o un administrador puede modificar pedidos', status: 403 };
    }

    if (!status) {
      return { ok: false, error: 'Estado requerido', status: 400 };
    }

    const validStatuses = ['draft', 'sent', 'partial', 'received', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return { ok: false, error: 'Estado inválido', status: 400 };
    }

    if (status === 'received') {
      return { ok: false, error: 'Marca el pedido como recibido desde la recepción', status: 400 };
    }

    // State machine: transiciones válidas vía PATCH. El único camino a
    // 'received' es receivePurchaseOrder (que acredita stock una sola vez).
    const PATCH_TRANSITIONS: Record<string, string[]> = {
      draft: ['sent', 'cancelled'],
      sent: ['cancelled'],
      partial: ['cancelled'],
      received: [],
      cancelled: [],
    };

    const { data: order, error: fetchError } = await supabaseAdmin
      .from('purchase_orders')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', auth.tenantId)
      .single();

    if (fetchError || !order) {
      return { ok: false, error: 'Pedido no encontrado', status: 404 };
    }

    const allowedNext = PATCH_TRANSITIONS[order.status as string] ?? [];
    if (!allowedNext.includes(status)) {
      return { ok: false, error: `No se puede cambiar el pedido de "${order.status}" a "${status}"`, status: 400 };
    }

    const updateData: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
    };

    const { data: updatedOrder, error: poError } = await supabaseAdmin
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

    await createActivityLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: 'cancelled',
      entityType: 'purchase_order',
      entityId: id,
      details: { folio: id.slice(0, 8) },
    });

    return { ok: true, data: updatedOrder, status: 200 };
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

  const role = await getRoleInTenant(auth.userId, auth.tenantId);
  if (!canManageTenant(role)) {
    return { ok: false, error: 'Solo el dueño o un administrador puede recibir pedidos', status: 403 };
  }

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

  if (order.status === 'received') {
    return { ok: false, error: 'El pedido ya fue recibido', status: 400 };
  }
  if (order.status === 'cancelled') {
    return { ok: false, error: 'El pedido fue cancelado', status: 400 };
  }

  const supplier = order.supplier as Record<string, unknown> | undefined;
  const supplierName = (supplier?.name as string) || 'Proveedor';

  const { data: poItems } = await supabaseAdmin
    .from('purchase_order_items')
    .select('*, product:products(id, name)')
    .eq('purchase_order_id', purchaseOrderId);

  if (!poItems || poItems.length === 0) {
    return { ok: false, error: 'El pedido no tiene productos', status: 400 };
  }

  // Valida y capita cada cantidad a recibir: entero positivo, nunca mayor al
  // saldo pendiente (quantity_ordered - quantity_received).
  const receivingQuantities = new Map<string, number>();
  let atLeastOne = false;
  for (const item of poItems as Record<string, unknown>[]) {
    const productId = item.product_id as string;
    const orderedQty = Number(item.quantity_ordered) || 0;
    const currentQtyReceived = Number(item.quantity_received) || 0;

    const receivedItem = items.find((i: { product_id: string }) => i.product_id === productId);
    const requested = Number(receivedItem?.quantity_received) || 0;

    if (requested <= 0 || !Number.isInteger(requested)) {
      receivingQuantities.set(productId, 0);
      continue;
    }

    const pending = Math.max(0, orderedQty - currentQtyReceived);
    const capped = Math.min(requested, pending);
    receivingQuantities.set(productId, capped);
    if (capped > 0) atLeastOne = true;
  }

  if (!atLeastOne) {
    return { ok: false, error: 'Ingresa una cantidad válida para recibir', status: 400 };
  }

  const remitoItems = poItems.map((item: Record<string, unknown>) => {
    const product = item.product as Record<string, unknown> | undefined;
    const productId = item.product_id as string;
    const productName = (product?.name as string) || 'Producto';
    const unitCostCents = Number(item.unit_cost_cents) || 0;

    const qtyReceivingNow = receivingQuantities.get(productId) || 0;

    return {
      product_id: productId,
      description: productName,
      quantity: qtyReceivingNow,
      unit_price_cents: unitCostCents,
    };
  });

  const totalCents = remitoItems.reduce((sum, item) => sum + item.unit_price_cents * item.quantity, 0);

  // El numero del remito se reclama justo antes de insertar, con compare-and-set,
  // para que dos recepciones simultaneas no lean el mismo numero: la primera
  // avanza el contador y la segunda reintenta con el valor ya avanzado. Antes el
  // contador se leia al principio y se actualizaba ciego al final, asi que dos
  // recepciones concurrentes podian insertar el mismo documento y el update podia
  // retroceder el contador (lost update), colisiones que solo frenaba el UNIQUE.
  let document: Record<string, unknown> | null = null;
  let nextNumber = 0;
  for (let attempt = 0; attempt < 5 && !document; attempt++) {
    const claim = await claimCommercialDocumentNumber(auth.tenantId, 'remito_ingreso');
    if (!claim.ok) return claim;
    nextNumber = claim.number;

    const { data, error: docError } = await supabaseAdmin
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

    if (!docError) {
      document = data as Record<string, unknown>;
      break;
    }

    // No era un numero repetido: se devuelve el numero para no dejar hueco.
    if (docError.code !== '23505') {
      await releaseCommercialDocumentNumber(auth.tenantId, 'remito_ingreso', nextNumber);
    }
    console.error('DB error:', docError);
  }

  if (!document) {
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

  // Si el lote de la recepcion (051) falla despues de que este remito ya se
  // inserto, hay que devolver ambas cosas: el documento y su folio.
  const compensateRemito = async () => {
    await supabaseAdmin.from('commercial_documents').delete().eq('id', document.id);
    await releaseCommercialDocumentNumber(auth.tenantId, 'remito_ingreso', nextNumber);
  };

  const { error: itemsError } = await supabaseAdmin
    .from('commercial_document_items')
    .insert(documentItems);

  if (itemsError) {
    await compensateRemito();
    console.error('DB error:', itemsError);
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 400 };
  }

  // El incremento de `quantity_received` (con tope), el credito de stock y el
  // status de la orden van en UNA llamada por RPC (migracion 051), bajo el lock
  // de fila de la orden. Antes eran N+2 viajes con read-modify-write sobre el
  // stock: dos recepciones simultaneas de la misma orden acreditaban el stock
  // el DOBLE y el cap "<= pendiente" no las frenaba, porque ambas habian leido
  // que faltaba todo por recibir.
  const incItems = [...receivingQuantities.entries()]
    .filter(([, inc]) => inc > 0)
    .map(([product_id, quantity_received]) => ({ product_id, quantity_received }));

  const { data, error: receiveError } = await supabaseAdmin.rpc('receive_po_stock', {
    p_order_id: purchaseOrderId,
    p_tenant_id: auth.tenantId,
    p_by: auth.userId,
    p_items: incItems,
    p_received_date: received_date || new Date().toISOString().split('T')[0],
    p_deposito: deposito ?? null,
    p_pasillo: pasillo ?? null,
    p_estanteria: estanteria ?? null,
  });

  const outcome = (data as Array<Record<string, unknown>> | null)?.[0];

  if (receiveError) {
    await compensateRemito();
    // P0001 son los `raise` de la funcion: mensajes armados para el usuario,
    // como el de tope de lo pedido.
    if (receiveError.code === 'P0001') {
      return { ok: false, error: receiveError.message || 'Ocurrio un error inesperado. Intenta de nuevo.', status: 400 };
    }
    console.error('receive_po_stock fallo:', receiveError);
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 400 };
  }

  if (!outcome?.ok) {
    await compensateRemito();
    // La foto de la orden en esta peticion podia agregar una recepcion ya
    // hecha o una cancelacion que se registro mientras tanto.
    if (outcome?.code === 'already_received') {
      return { ok: false, error: 'El pedido ya fue recibido', status: 400 };
    }
    if (outcome?.code === 'cancelled') {
      return { ok: false, error: 'El pedido fue cancelado', status: 400 };
    }
    if (outcome?.code === 'not_found') {
      return { ok: false, error: 'Pedido no encontrado', status: 404 };
    }
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 400 };
  }

  const row = (outcome.row as Record<string, unknown> | undefined) ?? {};
  const allFullyReceived = Boolean(row.all);
  const newStatus = (row.status as string) || (allFullyReceived ? 'received' : 'partial');

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

  // first_purchase se graba en la RECEPCION, no en el alta de la orden.
  // Dar de alta una orden no mueve stock ni cuesta plata: se puede hacer
  // sola para dejarla lista. Lo que marca que el usuario compro de
  // verdad es recibir la mercaderia, que es el mismo paso en el que el
  // stock entra al deposito. Medirlo en el alta daria un numero
  // inflado por gente que armo la orden y la dejo colgada.
  await trackEvent({
    type: 'first_purchase',
    userId: auth.userId,
    tenantId: auth.tenantId,
    metadata: { purchaseOrderId, partial: !allFullyReceived },
  });

  return {
    ok: true,
    status: 201,
    data: { ...fullDocument, po_status: newStatus },
  };
}