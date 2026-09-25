import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { createActivityLog } from '@/lib/activity-log';
import type { AuthInfo } from '@/lib/api-auth';

export type StockTransferResult<T = unknown> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: string; status: number };

export async function listTransfers(auth: AuthInfo, statusFilter: string | null): Promise<StockTransferResult> {
  let q = supabaseAdmin
    .from('stock_transfers')
    .select(`
      *,
      items:stock_transfer_items(
        *,
        product:products(name)
      )
    `);

  const ids = auth.tenantIds.map((t) => `"${t}"`).join(',');
  const filter = `from_tenant_id.in.(${ids}),to_tenant_id.in.(${ids})`;
  q = q.or(filter);
  if (statusFilter) {
    q = q.eq('status', statusFilter);
  }

  q = q.order('created_at', { ascending: false });

  const { data, error } = await q;
  if (error) {
    console.error('DB error:', error);
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
  }

  const tenantIds = new Set<string>();
  for (const t of data || []) {
    tenantIds.add(t.from_tenant_id);
    tenantIds.add(t.to_tenant_id);
  }

  const { data: tenants } = await supabaseAdmin
    .from('tenants')
    .select('id, name')
    .in('id', [...tenantIds]);

  const tenantMap = new Map((tenants || []).map((t) => [t.id, t.name]));

  const userIds = new Set((data || []).map((t) => t.created_by));
  const { data: profiles } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name')
    .in('id', [...userIds]);

  const userMap = new Map((profiles || []).map((p) => [p.id, p.full_name]));

  const result = (data || []).map((t) => ({
    ...t,
    from_tenant_name: tenantMap.get(t.from_tenant_id) || 'Desconocido',
    to_tenant_name: tenantMap.get(t.to_tenant_id) || 'Desconocido',
    created_by_name: userMap.get(t.created_by) || 'Usuario',
    items: (t.items || []).map((item: Record<string, unknown>) => {
      const product = item.product as Record<string, unknown> | undefined;
      return { ...item, product_name: product?.name ?? null };
    }),
  }));

  return { ok: true, data: result, status: 200 };
}

export async function createTransfer(
  auth: AuthInfo,
  body: { from_tenant_id?: string; to_tenant_id?: string; notes?: string; items?: Array<Record<string, unknown>> }
): Promise<StockTransferResult> {
  const { from_tenant_id, to_tenant_id, notes, items } = body;

  if (!from_tenant_id || !to_tenant_id) {
    return { ok: false, error: 'Origen y destino son requeridos', status: 400 };
  }

  if (from_tenant_id === to_tenant_id) {
    return { ok: false, error: 'Origen y destino deben ser diferentes', status: 400 };
  }

  if (!auth.tenantIds.includes(from_tenant_id) || !auth.tenantIds.includes(to_tenant_id)) {
    return { ok: false, error: 'No tienes permisos sobre esos tenants', status: 403 };
  }

  if (!items || !Array.isArray(items) || items.length === 0) {
    return { ok: false, error: 'Debe incluir al menos un producto', status: 400 };
  }

  const { data: transfer, error: transferError } = await supabaseAdmin
    .from('stock_transfers')
    .insert({
      from_tenant_id,
      to_tenant_id,
      status: 'pending',
      notes: notes || null,
      created_by: auth.userId,
    })
    .select()
    .single();

  if (transferError || !transfer) {
    return {
      ok: false,
      error: transferError ? 'Error al crear la transferencia' : 'Error al crear transferencia',
      status: 400,
    };
  }

  const transferItems = items.map((item) => ({
    transfer_id: transfer.id,
    product_id: item.product_id,
    quantity: item.quantity,
  }));

  const { error: itemsError } = await supabaseAdmin
    .from('stock_transfer_items')
    .insert(transferItems);

  if (itemsError) {
    await supabaseAdmin.from('stock_transfers').delete().eq('id', transfer.id);
    console.error('DB error:', itemsError);
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 400 };
  }

  await createActivityLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: 'created',
    entityType: 'stock_transfer',
    entityId: transfer.id,
    details: { from_tenant_id, to_tenant_id, items_count: items.length },
  });

  return { ok: true, data: transfer, status: 201 };
}

export async function updateTransferStatus(
  auth: AuthInfo,
  id: string,
  status: string
): Promise<StockTransferResult> {
  if (!status || !['pending', 'in_transit', 'received'].includes(status)) {
    return { ok: false, error: 'Estado inválido', status: 400 };
  }

  const TRANSFER_TRANSITIONS: Record<string, string[]> = {
    pending: ['in_transit'],
    in_transit: ['received'],
    received: [],
  };

  const { data: transfer, error: fetchError } = await supabaseAdmin
    .from('stock_transfers')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchError || !transfer) {
    return { ok: false, error: 'Transferencia no encontrada', status: 404 };
  }

  const userCanAccess =
    auth.tenantIds.includes(transfer.from_tenant_id) || auth.tenantIds.includes(transfer.to_tenant_id);
  if (!userCanAccess) {
    return { ok: false, error: 'No tienes permisos sobre esta transferencia', status: 403 };
  }

  // Transiciones estrictas: no se puede volver atrás ni saltar estados.
  // En particular in_transit -> pending queda prohibido (el stock de origen
  // ya fue descontado y no se revierte).
  const allowedNext = TRANSFER_TRANSITIONS[transfer.status as string] ?? [];
  if (!allowedNext.includes(status)) {
    return { ok: false, error: `No se puede cambiar la transferencia de "${transfer.status}" a "${status}"`, status: 400 };
  }

  const { data: items, error: itemsError } = await supabaseAdmin
    .from('stock_transfer_items')
    .select('*, product:products(name)')
    .eq('transfer_id', id);

  if (itemsError || !items) {
    return { ok: false, error: 'Error al obtener items', status: 500 };
  }

  if (status === 'in_transit') {
    for (const item of items) {
      let deducted = false;
      for (let attempt = 0; attempt < 5 && !deducted; attempt++) {
        const { data: stock } = await supabaseAdmin
          .from('product_stock')
          .select('stock')
          .eq('product_id', item.product_id)
          .eq('tenant_id', transfer.from_tenant_id)
          .maybeSingle();

        const currentStock = stock?.stock ?? 0;
        if (currentStock < item.quantity) {
          const itemWithProduct = item as { product?: { name?: string } };
          const productName = itemWithProduct.product?.name || 'Producto';
          return {
            ok: false,
            error: `Stock insuficiente de "${productName}" en origen. Disponible: ${currentStock}, requerido: ${item.quantity}`,
            status: 400,
          };
        }

        // Decremento con optimistic concurrency: solo aplica si nadie modificó
        // el stock desde la lectura. Si no lo logra, reintenta.
        const { data: updated, error: updateError } = await supabaseAdmin
          .from('product_stock')
          .update({ stock: currentStock - item.quantity, updated_at: new Date().toISOString() })
          .eq('product_id', item.product_id)
          .eq('tenant_id', transfer.from_tenant_id)
          .eq('stock', currentStock)
          .select('id')
          .maybeSingle();

        if (updateError) {
          return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
        }
        if (updated) deducted = true;
      }

      if (!deducted) {
        return { ok: false, error: 'No se pudo actualizar el stock de origen. Intenta de nuevo.', status: 409 };
      }

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
      const creditResult = await creditDestinationStock(
        transfer.from_tenant_id,
        transfer.to_tenant_id,
        item.product_id,
        item.quantity,
        auth.userId
      );
      if (!creditResult.ok) {
        return { ok: false, error: creditResult.error, status: creditResult.status };
      }
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
    console.error('DB error:', updateError);
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
  }

  await createActivityLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: status === 'in_transit' ? 'sent' : 'received',
    entityType: 'stock_transfer',
    entityId: id,
    details: { status, from_tenant_id: transfer.from_tenant_id, to_tenant_id: transfer.to_tenant_id },
  });

  return { ok: true, data: updated, status: 200 };
}

export async function deleteTransfer(auth: AuthInfo, id: string): Promise<StockTransferResult> {
  const { data: transfer, error: fetchError } = await supabaseAdmin
    .from('stock_transfers')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchError || !transfer) {
    return { ok: false, error: 'Transferencia no encontrada', status: 404 };
  }

  if (transfer.status !== 'pending') {
    return { ok: false, error: 'Solo se pueden cancelar transferencias pendientes de envío', status: 400 };
  }

  if (
    auth.tenantIds.includes(transfer.from_tenant_id) === false &&
    auth.tenantIds.includes(transfer.to_tenant_id) === false
  ) {
    return { ok: false, error: 'No tienes permisos sobre esta transferencia', status: 403 };
  }

  const { error: deleteError } = await supabaseAdmin
    .from('stock_transfers')
    .delete()
    .eq('id', id);

  if (deleteError) {
    console.error('DB error:', deleteError);
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
  }

  await createActivityLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: 'deleted',
    entityType: 'stock_transfer',
    entityId: id,
    details: { from_tenant_id: transfer.from_tenant_id, to_tenant_id: transfer.to_tenant_id },
  });

  return { ok: true, data: { success: true }, status: 200 };
}

type CreditResult = { ok: true } | { ok: false; error: string; status: number };

/**
 * Crédita stock en el tenant destino con optimistic concurrency:
 * 1) si la fila existe, la actualiza con guarda `stock = currentStock`;
 * 2) si no existe, la inserta (si otro request la creó en el mientras, el loop
 *    reintenta con el update). Previene doble acreditación por requests
 *    concurrentes contra la misma transferencia.
 */
async function creditDestinationStock(
  fromTenantId: string,
  toTenantId: string,
  productId: string,
  quantity: number,
  createdBy: string
): Promise<CreditResult> {
  let credited = false;
  for (let attempt = 0; attempt < 5 && !credited; attempt++) {
    const { data: stock } = await supabaseAdmin
      .from('product_stock')
      .select('stock')
      .eq('product_id', productId)
      .eq('tenant_id', toTenantId)
      .maybeSingle();

    if (stock) {
      const currentStock = Number(stock.stock) || 0;
      const { data: updated, error } = await supabaseAdmin
        .from('product_stock')
        .update({ stock: currentStock + quantity, updated_at: new Date().toISOString() })
        .eq('product_id', productId)
        .eq('tenant_id', toTenantId)
        .eq('stock', currentStock)
        .select('id')
        .maybeSingle();

      if (error) {
        return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
      }
      if (updated) credited = true;
    } else {
      const { data: inserted, error } = await supabaseAdmin
        .from('product_stock')
        .insert({
          product_id: productId,
          tenant_id: toTenantId,
          stock: quantity,
          min_stock: 0,
          max_stock: 0,
        })
        .select('id')
        .maybeSingle();

      if (error) {
        if (error.code === '23505') continue; // unique (product_id,tenant_id): reintentar update
        return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
      }
      if (inserted) credited = true;
    }
  }

  if (!credited) {
    return { ok: false, error: 'No se pudo actualizar el stock de destino. Intenta de nuevo.', status: 409 };
  }

  await supabaseAdmin.from('stock_history').insert({
    tenant_id: toTenantId,
    product_id: productId,
    quantity,
    type: 'transfer',
    reason: `Transferencia desde ${fromTenantId}`,
    created_by: createdBy,
  });

  return { ok: true };
}