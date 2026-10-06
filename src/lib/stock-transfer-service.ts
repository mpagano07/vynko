import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { createActivityLog } from '@/lib/activity-log';
import type { AuthInfo } from '@/lib/api-auth';
import { canManageTenant, getRoleInTenant } from '@/lib/membership-role';

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

  const [fromRole, toRole] = await Promise.all([
    getRoleInTenant(auth.userId, from_tenant_id),
    getRoleInTenant(auth.userId, to_tenant_id),
  ]);
  if (!canManageTenant(fromRole) || !canManageTenant(toRole)) {
    return { ok: false, error: 'Solo el dueño o un administrador puede crear transferencias', status: 403 };
  }

  if (!items || !Array.isArray(items) || items.length === 0) {
    return { ok: false, error: 'Debe incluir al menos un producto', status: 400 };
  }

  // `products` es global y `product_id` viene del body: sin exigir la fila de
  // `product_stock` del tenant ORIGEN, A puede mover un producto que solo
  // existe para B y el alta de stock en destino lo deja expuesto en el
  // catalogo y en el forecast de una empresa que nunca lo compro.
  const productIds = [...new Set(items.map((item) => item.product_id).filter(Boolean))];
  if (productIds.length === 0) {
    return { ok: false, error: 'Debe incluir al menos un producto', status: 400 };
  }
  const { data: ownedStock } = await supabaseAdmin
    .from('product_stock')
    .select('product_id')
    .in('product_id', productIds)
    .eq('tenant_id', from_tenant_id);
  const ownedIds = new Set((ownedStock ?? []).map((row) => row.product_id as string));
  if (productIds.some((id) => !ownedIds.has(id as string))) {
    return { ok: false, error: 'Uno o mas productos no pertenecen a la sucursal origen', status: 400 };
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

  // Dirección: enviar exige estar en el tenant origen; recibir, en el destino.
  // (El rol owner/manager se valida en el tenant correspondiente, no solo la pertenencia.)
  const activeRole = await getRoleInTenant(auth.userId, auth.tenantId);
  if (!canManageTenant(activeRole)) {
    return { ok: false, error: 'Solo el dueño o un administrador puede operar transferencias', status: 403 };
  }

  const directsTransfer =
    (status === 'in_transit' && auth.tenantId === transfer.from_tenant_id) ||
    (status === 'received' && auth.tenantId === transfer.to_tenant_id);
  if (!directsTransfer) {
    return {
      ok: false,
      error: 'No tenés permisos para esta acción: el envío lo realiza la sucursal origen y la recepción, la sucursal destino',
      status: 403,
    };
  }

  // Transiciones estrictas: no se puede volver atrás ni saltar estados.
  // En particular in_transit -> pending queda prohibido (el stock de origen
  // ya fue descontado y no se revierte).
  const allowedNext = TRANSFER_TRANSITIONS[transfer.status as string] ?? [];
  if (!allowedNext.includes(status)) {
    return { ok: false, error: `No se puede cambiar la transferencia de "${transfer.status}" a "${status}"`, status: 400 };
  }

  // El cambio de estado, el debito/acreditacion de stock y la bitacora viajan
  // en UNA llamada por RPC (migracion 050). El UPDATE del status con guarda
  // corre PRIMERO bajo lock de fila: dos envios simultaneos de la misma
  // transferencia se serializan y el segundo ve el status cambiado, asi que el
  // debito no puede duplicarse. Antes eran N+2 viajes con CAS por item que,
  // bajo concurrencia, agotaban los reintentos o descontaban dos veces.
  const rpcName = status === 'in_transit' ? 'send_transfer' : 'receive_transfer';
  const { data, error: rpcError } = await supabaseAdmin.rpc(rpcName, {
    p_transfer_id: id,
    p_by: auth.userId,
  });

  if (rpcError) {
    // P0001 son los `raise` de la funcion: mensajes armados para el usuario,
    // como el de stock insuficiente con el nombre del producto.
    if (rpcError.code === 'P0001') {
      return { ok: false, error: rpcError.message || 'Ocurrio un error inesperado. Intenta de nuevo.', status: 400 };
    }
    console.error(rpcName + ' fallo:', rpcError);
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
  }

  const outcome = (data as Array<Record<string, unknown>> | null)?.[0];
  if (!outcome?.ok) {
    if (outcome?.code === 'not_found') {
      return { ok: false, error: 'Transferencia no encontrada', status: 404 };
    }
    if (outcome?.code === 'wrong_status') {
      // El status que leyo esta peticion era una foto vieja: otra operacion
      // gano la carrera. El mensaje usa el status REAL de la fila.
      return {
        ok: false,
        error: `No se puede cambiar la transferencia de "${outcome.current_status ?? transfer.status}" a "${status}"`,
        status: 400,
      };
    }
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
  }

  const updated = outcome.row as Record<string, unknown>;

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

  if (auth.tenantId !== transfer.from_tenant_id) {
    return { ok: false, error: 'Solo la sucursal origen puede cancelar la transferencia', status: 403 };
  }

  const originRole = await getRoleInTenant(auth.userId, transfer.from_tenant_id);
  if (!canManageTenant(originRole)) {
    return { ok: false, error: 'Solo el dueño o un administrador puede cancelar transferencias', status: 403 };
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



