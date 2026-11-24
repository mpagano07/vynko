import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { createActivityLog } from '@/lib/activity-log';
import type { AuthInfo } from '@/lib/api-auth';
import { getRoleInTenant, hasCapability } from '@/lib/membership-role';
import { logger } from '@/lib/logger';
import { sellableDisplayName } from '@/lib/types/variant';

interface VariantStockRow {
  id: string;
  product_id: string;
  label: string;
  stock: number;
}

function variantStocks(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value as Array<Record<string, unknown>>;
  return value ? [value as Record<string, unknown>] : [];
}

function variantRows(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value as Array<Record<string, unknown>>;
  return value ? [value as Record<string, unknown>] : [];
}

// Una transferencia no mezcla el padre con sus variantes: la clave de agrupacion
// es el par (producto, variante), igual que la usa `send_transfer` (075).
const transferItemKey = (productId: string, variantId: string | null) =>
  JSON.stringify([productId, variantId ?? '']);

export type StockTransferResult<T = unknown> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: string; status: number };

export async function listTransfers(auth: AuthInfo, statusFilter: string | null, days?: number | null): Promise<StockTransferResult> {
  const daysRaw = Number(days);
  const allowedDays = [7, 30, 60, 0];
  const daysFilter = allowedDays.includes(daysRaw) ? daysRaw : 7;
  let q = supabaseAdmin
    .from('stock_transfers')
    .select(`
      *,
      items:stock_transfer_items(
        *,
        product:products(name),
        variant:product_variants(label)
      )
    `);

  const ids = auth.tenantIds.map((t) => `"${t}"`).join(',');
  const filter = `from_tenant_id.in.(${ids}),to_tenant_id.in.(${ids})`;
  q = q.or(filter);
  if (statusFilter) {
    const statuses = statusFilter.split(',').map((s) => s.trim()).filter(Boolean);
    if (statuses.length === 1) {
      q = q.eq('status', statuses[0]);
    } else if (statuses.length > 1) {
      q = q.in('status', statuses);
    }
  }
  if (daysFilter > 0) {
    const since = new Date(Date.now() - daysFilter * 24 * 60 * 60 * 1000).toISOString();
    q = q.gte('created_at', since);
  }
  q = q.order('created_at', { ascending: false });

  const { data, error } = await q;
  if (error) {
    logger.error('DB error:', { error });
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
      const variant = item.variant as Record<string, unknown> | undefined;
      const productName = product?.name ?? null;
      return {
        ...item,
        product_name: productName
          ? sellableDisplayName(String(productName), variant?.label ? String(variant.label) : null)
          : null,
      };
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
  if (!hasCapability(fromRole, 'manage_purchases') || !hasCapability(toRole, 'manage_purchases')) {
    return { ok: false, error: 'Solo el dueño o un administrador puede crear transferencias', status: 403 };
  }

  if (!items || !Array.isArray(items) || items.length === 0) {
    return { ok: false, error: 'Debe incluir al menos un producto', status: 400 };
  }

  // Normaliza y agrupa las líneas antes de tocar la base. El body puede traer
  // cantidades negativas, decimales o el mismo producto repetido; dos líneas
  // de 6 contra un stock de 10 pasaban el chequeo por separado y el envío
  // fallaba recién al descontar 12.
  const quantities = new Map<string, { productId: string; variantId: string | null; quantity: number }>();
  const usageByProduct = new Map<string, { simple: boolean; variant: boolean }>();
  for (const item of items) {
    const productId = typeof item.product_id === 'string' ? item.product_id : '';
    const variantId = item.variant_id ? String(item.variant_id) : null;
    const quantity = typeof item.quantity === 'number' ? item.quantity : Number(item.quantity);
    if (!productId || !Number.isInteger(quantity) || quantity <= 0) {
      return { ok: false, error: 'Las cantidades deben ser enteros mayores a 0', status: 400 };
    }
    const key = transferItemKey(productId, variantId);
    const current = quantities.get(key);
    if (current) current.quantity += quantity;
    else quantities.set(key, { productId, variantId, quantity });

    const usage = usageByProduct.get(productId) ?? { simple: false, variant: false };
    if (variantId) usage.variant = true;
    else usage.simple = true;
    usageByProduct.set(productId, usage);
  }
  for (const [productId, usage] of usageByProduct) {
    if (usage.simple && usage.variant) {
      return {
        ok: false,
        error: `No se puede transferir "${productId}" como producto y como variante en la misma transferencia`,
        status: 400,
      };
    }
  }

  // `products` es global y `product_id` viene del body: sin exigir la fila de
  // `product_stock` del tenant ORIGEN, A puede mover un producto que solo
  // existe para B y el alta de stock en destino lo deja expuesto en el
  // catalogo y en el forecast de una empresa que nunca lo compro.
  const lines = [...quantities.values()];
  const productIds = [...new Set(lines.map((line) => line.productId))];
  const [{ data: ownedStock }, { data: productRows }, { data: variantData, error: variantError }] =
    await Promise.all([
      supabaseAdmin
        .from('product_stock')
        .select('product_id, stock')
        .in('product_id', productIds)
        .eq('tenant_id', from_tenant_id),
      supabaseAdmin
        .from('products')
        .select('id, name')
        .in('id', productIds),
      supabaseAdmin
        .from('product_variants')
        .select('id, product_id, label, variant_stock!inner(tenant_id, stock, active)')
        .in('product_id', productIds),
    ]);

  if (variantError) {
    logger.error('DB error:', { error: variantError });
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
  }
  const stockById = new Map(
    (ownedStock ?? []).map((row) => [row.product_id as string, Number(row.stock) || 0])
  );
  const nameById = new Map(
    (productRows ?? []).map((row) => [row.id as string, row.name as string])
  );
  const variantById = new Map<string, VariantStockRow>();
  const productsWithVariants = new Set<string>();
  for (const raw of variantRows(variantData)) {
    const row = raw as Record<string, unknown>;
    const own = variantStocks(row.variant_stock).filter(
      (s) => String(s.tenant_id) === from_tenant_id
    );
    if (own.some((s) => Boolean(s.active))) {
      productsWithVariants.add(String(row.product_id));
      variantById.set(String(row.id), {
        id: String(row.id),
        product_id: String(row.product_id),
        label: String(row.label ?? ''),
        stock: own.reduce((sum, s) => sum + (Number(s.stock) || 0), 0),
      });
    }
  }
  if (productIds.some((id) => !stockById.has(id))) {
    return { ok: false, error: 'Uno o mas productos no pertenecen a la sucursal origen', status: 400 };
  }

  // Se valida contra el stock actual para no crear una transferencia que ya
  // nace imposible: antes se aceptaba y el error aparecía recién al confirmar
  // el envío. El `send_transfer` vuelve a chequear bajo lock por si el stock
  // cambió entre la creación y el envío.
  for (const { productId, variantId, quantity } of lines) {
    let available: number;
    let label: string | null = null;
    if (variantId) {
      const variant = variantById.get(variantId);
      if (!variant || variant.product_id !== productId) {
        return {
          ok: false,
          error: 'La variante no pertenece al producto o a la sucursal origen',
          status: 400,
        };
      }
      available = variant.stock;
      label = variant.label;
    } else {
      if (productsWithVariants.has(productId)) {
        return {
          ok: false,
          error: `El producto "${nameById.get(productId) || productId}" tiene variantes: transferí una variante`,
          status: 400,
        };
      }
      available = stockById.get(productId) ?? 0;
    }
    if (quantity > available) {
      const name = sellableDisplayName(nameById.get(productId) || productId, label);
      return {
        ok: false,
        error: `Stock insuficiente de "${name}". Disponible: ${available}, requerido: ${quantity}`,
        status: 400,
      };
    }
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

  const transferItems = lines.map(({ productId, variantId, quantity }) => ({
    transfer_id: transfer.id,
    product_id: productId,
    quantity,
    ...(variantId ? { variant_id: variantId } : {}),
  }));

  const { error: itemsError } = await supabaseAdmin
    .from('stock_transfer_items')
    .insert(transferItems);

  if (itemsError) {
    await supabaseAdmin.from('stock_transfers').delete().eq('id', transfer.id);
    logger.error('DB error:', { error: itemsError });
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
  if (!hasCapability(activeRole, 'manage_purchases')) {
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
    logger.error(`${rpcName} fallo`, { error: rpcError });
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
  if (!hasCapability(originRole, 'manage_purchases')) {
    return { ok: false, error: 'Solo el dueño o un administrador puede cancelar transferencias', status: 403 };
  }

  const { error: deleteError } = await supabaseAdmin
    .from('stock_transfers')
    .delete()
    .eq('id', id);

  if (deleteError) {
    logger.error('DB error:', { error: deleteError });
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



