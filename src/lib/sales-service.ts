import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { createActivityLog } from '@/lib/activity-log';
import { reduceStockForSale, buildStockMovement } from '@/lib/stock';
import { isPaymentMethodId, normalizeCheckoutSettings } from '@/lib/payment-methods';
import type { AuthInfo } from '@/lib/api-auth';

type SalesQueryResult = { data?: unknown; total?: number; page?: number; limit?: number };
type SalesQueryFailure = { ok: false; error: string };

export type ListSalesResult =
  | ({ ok: true } & SalesQueryResult)
  | SalesQueryFailure;

function formatTodayDate(tz: string) {
  const now = new Date();
  const todayStr = now.toLocaleDateString('en-CA', { timeZone: tz });
  const [y, m, d] = todayStr.split('-').map(Number);
  const noonUTC = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const fmtDate = (date: Date, timeZone: string) => new Date(date.toLocaleString('en-US', { timeZone }));
  const offsetMs = fmtDate(noonUTC, tz).getTime() - fmtDate(noonUTC, 'UTC').getTime();
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0).valueOf() - offsetMs);
}

function flattenSale(row: Record<string, unknown>) {
  const customer = row.customer as Record<string, unknown> | undefined;
  const items = (row.items as Record<string, unknown>[] | undefined) ?? [];
  return {
    ...row,
    customer_name: customer?.name ?? null,
    items: items.map((i: Record<string, unknown>) => {
      const product = i.product as Record<string, unknown> | undefined;
      return { ...i, product_name: product?.name ?? null };
    }),
  };
}

export async function getTodaySales(auth: AuthInfo, tz: string): Promise<ListSalesResult> {
  const todayStart = formatTodayDate(tz);
  let query = supabaseAdmin
    .from('sales')
    .select('id, total_cents, created_at')
    .gte('created_at', todayStart.toISOString())
    .order('created_at', { ascending: false });
  if (auth.allTenants) query = query.in('tenant_id', auth.tenantIds);
  else query = query.eq('tenant_id', auth.tenantId);

  const { data: sales, error } = await query;
  if (error) {
    console.error('DB error:', error);
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.' };
  }
  return { ok: true, data: sales ?? [] };
}

export async function listSales(
  auth: AuthInfo,
  options: { days?: number | null; page?: number; limit?: number; hasPagination: boolean }
): Promise<ListSalesResult> {
  const { days = null, page = 1, limit = 15, hasPagination } = options;
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabaseAdmin
    .from('sales')
    .select(
      `
        *,
        items:sale_items(
          *,
          product:products(name)
        ),
        customer:customers(name)
      `,
      hasPagination ? { count: 'exact' } : undefined
    )
    .eq('tenant_id', auth.tenantId);

  if (days && days > 0) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    query = query.gte('created_at', since.toISOString());
  }

  query = query.order('created_at', { ascending: false });

  if (hasPagination) query = query.range(from, to);

  const { data: sales, error, count } = await query;
  if (error) {
    console.error('DB error:', error);
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.' };
  }

  const result = (sales ?? []).map(flattenSale);
  if (hasPagination) {
    return { ok: true, data: result, total: count ?? 0, page, limit };
  }
  return { ok: true, data: result };
}

interface ResolvedPayment {
  method: string;
  allocation_cents: number;
  amount_cents: number;
  received_cents: number;
  change_cents: number;
}

interface SaleItemData {
  product_id: string;
  quantity: number;
  unit_price_cents: number;
  subtotal_cents: number;
  product_name: string;
}

interface ProductRow {
  id: string;
  name: string;
  price: number;
  price_cents?: number;
}

interface CreateSaleBody {
  customer_id?: string;
  notes?: string;
  items: { product_id: string; quantity: number }[];
  payment_method?: string;
  amount_paid?: number | null;
  discount_percent?: number | null;
  surcharge_percent?: number | null;
  payments?: { method: string; amount: number; received?: number | null }[];
}

export type CreateSaleResult =
  | {
      ok: true;
      sale: Record<string, unknown>;
      items: Record<string, unknown>[];
      payments: Record<string, unknown>[];
      adjustments_applied: Record<string, unknown>;
    }
  | { ok: false; error: string; status?: number };

export async function createSale(auth: AuthInfo, body: CreateSaleBody): Promise<CreateSaleResult> {
  const [{ data: tenantRow }, { data: openSession }] = await Promise.all([
    supabaseAdmin.from('tenants').select('settings').eq('id', auth.tenantId).maybeSingle(),
    supabaseAdmin
      .from('cash_register_sessions')
      .select('id')
      .eq('tenant_id', auth.tenantId)
      .eq('status', 'open')
      .maybeSingle(),
  ]);
  const checkoutSettings = normalizeCheckoutSettings(
    (tenantRow?.settings as Record<string, unknown> | undefined)?.checkout
  );
  const sessionId = openSession?.id ?? null;

  const { customer_id, notes, items, payment_method = 'cash', amount_paid, discount_percent = 0, surcharge_percent = 0, payments } = body;

  if (!isPaymentMethodId(payment_method)) {
    return { ok: false, error: 'Medio de pago inválido', status: 400 };
  }

  if (!items || !Array.isArray(items) || items.length === 0) {
    return { ok: false, error: 'La venta debe tener al menos un producto', status: 400 };
  }

  const discountPct = Math.max(0, Number(discount_percent) || 0);
  const surchargePct = Math.max(0, Number(surcharge_percent) || 0);
  if (discountPct > 100 || surchargePct > 100) {
    return { ok: false, error: 'El descuento o recargo no puede superar el 100%', status: 400 };
  }

  const productIds = items.map((i) => i.product_id);
  const { data: products, error: prodError } = await supabaseAdmin
    .from('products')
    .select('id, name, price, price_cents')
    .in('id', productIds);

  if (prodError) {
    console.error('DB error:', prodError);
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
  }

  const { data: stockRows } = await supabaseAdmin
    .from('product_stock')
    .select('product_id, stock')
    .in('product_id', productIds)
    .eq('tenant_id', auth.tenantId);

  const stockMap = new Map((stockRows ?? []).map((s) => [s.product_id, s.stock ?? 0]));
  const productMap = new Map((products ?? []).map((p) => [p.id, p as unknown as ProductRow]));

  try {
  const saleItems: SaleItemData[] = items.map((item) => {
    const product = productMap.get(item.product_id);
    if (!product) throw new Error(`Producto no encontrado: ${item.product_id}`);

    const quantity = Number(item.quantity) || 1;
    const unit_price_cents = product.price_cents ?? Math.round(Number(product.price) * 100);
    const subtotal_cents = quantity * unit_price_cents;

    const availableStock = stockMap.get(item.product_id) ?? 0;
    const stockResult = reduceStockForSale(availableStock, quantity, product.name);
    if (!stockResult.ok) throw new Error(stockResult.error);

    return { product_id: item.product_id, quantity, unit_price_cents, subtotal_cents, product_name: product.name };
  });

  const subtotal_cents = saleItems.reduce((sum, item) => sum + item.subtotal_cents, 0);
  const discount_cents = Math.round((subtotal_cents * discountPct) / 100);
  const surcharge_cents = Math.round((subtotal_cents * surchargePct) / 100);
  const total_cents = Math.max(0, subtotal_cents - discount_cents + surcharge_cents);

  const isSplit = Array.isArray(payments) && payments.length > 0;
  const resolvedPayments: ResolvedPayment[] = [];

  if (isSplit) {
    let allocationSum = 0;
    for (const p of payments) {
      if (!isPaymentMethodId(p.method)) {
        return { ok: false, error: `Medio de pago inválido: ${p.method}`, status: 400 };
      }
      const allocationCents = Math.max(0, Math.round(Number(p.amount) * 100));
      if (!(allocationCents > 0)) {
        return { ok: false, error: 'Cada medio de pago debe tener un monto mayor a 0', status: 400 };
      }
      allocationSum += allocationCents;
    }
    if (Math.abs(allocationSum - total_cents) > 1) {
      return {
        ok: false,
        error: `El reparto del pago no cubre el total ($${(total_cents / 100).toFixed(2)} vs $${(allocationSum / 100).toFixed(2)})`,
        status: 400,
      };
    }

    for (const p of payments) {
      const method = p.method as keyof typeof checkoutSettings.payment_adjustments;
      const allocationCents = Math.max(0, Math.round(Number(p.amount) * 100));
      const adjustmentPct = checkoutSettings.payment_adjustments[method];
      const amountCents = Math.round((allocationCents * (100 + adjustmentPct)) / 100);
      let receivedCents = amountCents;
      let changeCents = 0;
      if (method === 'cash' && p.received != null) {
        receivedCents = Math.max(0, Math.round(Number(p.received) * 100));
      }
      if (receivedCents < amountCents) {
        return {
          ok: false,
          error: `El monto recibido para ${method} no puede ser menor al total del medio`,
          status: 400,
        };
      }
      changeCents = receivedCents - amountCents;
      resolvedPayments.push({ method, allocation_cents: allocationCents, amount_cents: amountCents, received_cents: receivedCents, change_cents: changeCents });
    }
  } else {
    const amountPaidRaw = Number(amount_paid ?? total_cents / 100);
    const amountPaidCents = Math.max(0, Math.round(amountPaidRaw * 100));
    const changeCents = Math.max(0, amountPaidCents - total_cents);

    if (payment_method !== 'cash' && amountPaidCents < total_cents) {
      return { ok: false, error: 'El monto cobrado no puede ser menor al total de la venta', status: 400 };
    }

    resolvedPayments.push({
      method: payment_method,
      allocation_cents: total_cents,
      amount_cents: total_cents,
      received_cents: amountPaidCents,
      change_cents: changeCents,
    });
  }

  const finalTotalCents = isSplit
    ? resolvedPayments.reduce((sum, p) => sum + p.amount_cents, 0)
    : total_cents;
  const amountPaidCents = resolvedPayments.reduce((sum, p) => sum + p.received_cents, 0);
  const changeCents = resolvedPayments.reduce((sum, p) => sum + p.change_cents, 0);
  const primaryMethod = resolvedPayments[0].method;
  const paymentRows = resolvedPayments.map((p) => ({
    method: p.method,
    amount_cents: p.amount_cents,
    received_cents: p.received_cents,
    change_cents: p.change_cents,
  }));

  const decrementStockAtomic = async (productId: string, productName: string, quantity: number): Promise<void> => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: row } = await supabaseAdmin
        .from('product_stock')
        .select('id, stock')
        .eq('product_id', productId)
        .eq('tenant_id', auth.tenantId)
        .maybeSingle();

      const available = row?.stock ?? 0;
      if (!row || available < quantity) {
        throw new Error(`Stock insuficiente para "${productName}" (disponible: ${available})`);
      }

      const { data: updated } = await supabaseAdmin
        .from('product_stock')
        .update({ stock: available - quantity, updated_at: new Date().toISOString() })
        .eq('id', row.id)
        .eq('stock', available)
        .select('id');

      if ((updated?.length ?? 0) > 0) return;
    }
    throw new Error(`Demasiada concurrencia sobre "${productName}". Intentá de nuevo.`);
  };

  const incrementStockAtomic = async (productId: string, quantity: number): Promise<void> => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: row } = await supabaseAdmin
        .from('product_stock')
        .select('id, stock')
        .eq('product_id', productId)
        .eq('tenant_id', auth.tenantId)
        .maybeSingle();
      if (!row) return;

      const { data: updated } = await supabaseAdmin
        .from('product_stock')
        .update({ stock: row.stock + quantity, updated_at: new Date().toISOString() })
        .eq('id', row.id)
        .eq('stock', row.stock)
        .select('id');

      if ((updated?.length ?? 0) > 0) return;
    }
  };

  const decremented: SaleItemData[] = [];
  try {
    for (const item of saleItems) {
      await decrementStockAtomic(item.product_id, item.product_name, item.quantity);
      decremented.push(item);
    }

    const { data: sale, error: saleError } = await supabaseAdmin
      .from('sales')
      .insert({
        tenant_id: auth.tenantId,
        customer_id: customer_id || null,
        total_cents: finalTotalCents,
        status: 'completed',
        notes: notes || null,
        sold_by: auth.userId,
        payment_method: primaryMethod,
        amount_paid_cents: amountPaidCents,
        change_cents: changeCents,
        discount_cents,
        surcharge_cents,
        session_id: sessionId,
      })
      .select()
      .single();

    if (saleError) throw new Error('No se pudo registrar la venta');

    const paymentsWithSaleId = paymentRows.map((p) => ({
      sale_id: sale.id,
      tenant_id: auth.tenantId,
      ...p,
    }));

    const { error: paymentsError } = await supabaseAdmin
      .from('sale_payments')
      .insert(paymentsWithSaleId);

    if (paymentsError) {
      await supabaseAdmin.from('sales').delete().eq('id', sale.id);
      throw new Error('No se pudieron guardar los pagos de la venta');
    }

    const itemsWithSaleId = saleItems.map((item) => ({
      sale_id: sale.id,
      product_id: item.product_id,
      quantity: item.quantity,
      unit_price_cents: item.unit_price_cents,
      subtotal_cents: item.subtotal_cents,
    }));

    const { error: itemsError } = await supabaseAdmin
      .from('sale_items')
      .insert(itemsWithSaleId);

    if (itemsError) {
      await supabaseAdmin.from('sales').delete().eq('id', sale.id);
      throw new Error('No se pudieron guardar los ítems de la venta');
    }

    for (const item of saleItems) {
      await supabaseAdmin.from('stock_history').insert(
        buildStockMovement({
          tenantId: auth.tenantId,
          productId: item.product_id,
          quantity: -item.quantity,
          type: 'out',
          reason: `Venta #${sale.id.slice(0, 8)}`,
          createdBy: auth.userId,
        })
      );
    }

    const itemNames = saleItems.map((i) => i.product_name).slice(0, 3);
    const detail = itemNames.join(', ') + (saleItems.length > 3 ? ` y ${saleItems.length - 3} más` : '');

    await createActivityLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: 'created',
      entityType: 'sale',
      entityId: sale.id,
      details: {
        total_cents: finalTotalCents,
        items_count: saleItems.length,
        products: detail,
        folio: sale.id.slice(0, 8),
        payment_method: primaryMethod,
      },
    });

    const adjustments_applied = isSplit
      ? Object.fromEntries(
          resolvedPayments.map((p) => [
            p.method,
            checkoutSettings.payment_adjustments[p.method as keyof typeof checkoutSettings.payment_adjustments],
          ])
        )
      : {};

    return {
      ok: true,
      sale,
      items: itemsWithSaleId,
      payments: paymentsWithSaleId,
      adjustments_applied,
    };
  } catch (err) {
    for (const item of decremented) {
      await incrementStockAtomic(item.product_id, item.quantity);
    }
    return { ok: false, error: err instanceof Error ? err.message : 'Error al procesar la venta', status: 400 };
  }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error al procesar la venta', status: 400 };
  }
}