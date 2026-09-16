import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { createActivityLog } from '@/lib/activity-log';
import { reduceStockForSale, buildStockMovement } from '@/lib/stock';
import { fixResponse } from '@/lib/utils/encoding';
import { isPaymentMethodId, normalizeCheckoutSettings } from '@/lib/payment-methods';

export async function GET(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const todayOnly = searchParams.get('today') === 'true';

  if (todayOnly) {
    const tz = searchParams.get('tz') || 'UTC';
    const now = new Date();
    const todayStr = now.toLocaleDateString('en-CA', { timeZone: tz });
    const [y, m, d] = todayStr.split('-').map(Number);
    const noonUTC = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    const fmtDate = (date: Date, timeZone: string) => new Date(date.toLocaleString('en-US', { timeZone }));
    const offsetMs = fmtDate(noonUTC, tz).getTime() - fmtDate(noonUTC, 'UTC').getTime();
    const todayStart = new Date(Date.UTC(y, m - 1, d, 0, 0, 0).valueOf() - offsetMs);
    let query = supabaseAdmin
      .from('sales')
      .select('id, total_cents, created_at')
      .gte('created_at', todayStart.toISOString())
      .order('created_at', { ascending: false });
    if (!auth.allTenants) query = query.eq('tenant_id', auth.tenantId);
    const { data: sales, error } = await query;

    if (error) { console.error('DB error:', error); return NextResponse.json({ error: 'Ocurrio un error inesperado. Intenta de nuevo.' }, { status: 500 }); }
    return NextResponse.json(fixResponse(sales ?? []));
  }

  const days = searchParams.get('days') ? parseInt(searchParams.get('days')!, 10) : null;
  const hasPagination = searchParams.has('page') || searchParams.has('limit') || days !== null;
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '15', 10)));
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabaseAdmin
    .from('sales')
    .select(`
      *,
      items:sale_items(
        *,
        product:products(name)
      ),
      customer:customers(name)
    `, hasPagination ? { count: 'exact' } : undefined)
    .eq('tenant_id', auth.tenantId);

  if (days && days > 0) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    query = query.gte('created_at', since.toISOString());
  }

  query = query.order('created_at', { ascending: false });

  if (hasPagination) {
    query = query.range(from, to);
  }

  const { data: sales, error, count } = await query;

  if (error) { console.error('DB error:', error); return NextResponse.json({ error: 'Ocurrio un error inesperado. Intenta de nuevo.' }, { status: 500 }); }

  const result = (sales ?? []).map((s: Record<string, unknown>) => {
    const customer = s.customer as Record<string, unknown> | undefined;
    const items = (s.items as Record<string, unknown>[] | undefined) ?? [];
    return {
      ...s,
      customer_name: customer?.name ?? null,
      items: items.map((i: Record<string, unknown>) => {
        const product = i.product as Record<string, unknown> | undefined;
        return {
          ...i,
          product_name: product?.name ?? null,
        };
      }),
    };
  });

  if (hasPagination) {
    return NextResponse.json(fixResponse({ data: result, total: count ?? 0, page, limit }));
  }
  return NextResponse.json(fixResponse(result));
}

export async function POST(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

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

  try {
    const body = await request.json();
    const { customer_id, notes, items, payment_method = 'cash', amount_paid, discount_percent = 0, surcharge_percent = 0, payments } = body as {
      customer_id?: string;
      notes?: string;
      items: { product_id: string; quantity: number }[];
      payment_method?: string;
      amount_paid?: number | null;
      discount_percent?: number | null;
      surcharge_percent?: number | null;
      payments?: { method: string; amount: number; received?: number | null }[];
    };

    if (!isPaymentMethodId(payment_method)) {
      return NextResponse.json({ error: 'Medio de pago inválido' }, { status: 400 });
    }

    const discountPct = Math.max(0, Number(discount_percent) || 0);
    const surchargePct = Math.max(0, Number(surcharge_percent) || 0);
    if (discountPct > 100 || surchargePct > 100) {
      return NextResponse.json({ error: 'El descuento o recargo no puede superar el 100%' }, { status: 400 });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'La venta debe tener al menos un producto' }, { status: 400 });
    }

    const productIds = items.map((i) => i.product_id);
    const { data: products, error: prodError } = await supabaseAdmin
      .from('products')
      .select('id, name, price, price_cents')
      .in('id', productIds);

    if (prodError) { console.error('DB error:', prodError); return NextResponse.json({ error: 'Ocurrio un error inesperado. Intenta de nuevo.' }, { status: 500 }); }

    const { data: stockRows } = await supabaseAdmin
      .from('product_stock')
      .select('product_id, stock')
      .in('product_id', productIds)
      .eq('tenant_id', auth.tenantId);

    const stockMap = new Map((stockRows ?? []).map((s) => [s.product_id, s.stock ?? 0]));

    type ProductRow = { id: string; name: string; price: number; price_cents?: number };
    const productMap = new Map((products ?? []).map((p) => [p.id, p as unknown as ProductRow]));

    interface SaleItemData {
      product_id: string;
      quantity: number;
      unit_price_cents: number;
      subtotal_cents: number;
      product_name: string;
    }

    const saleItems: SaleItemData[] = items.map((item) => {
      const product = productMap.get(item.product_id);
      if (!product) throw new Error(`Producto no encontrado: ${item.product_id}`);

      const quantity = Number(item.quantity) || 1;
      const unit_price_cents = product.price_cents ?? Math.round(Number(product.price) * 100);
      const subtotal_cents = quantity * unit_price_cents;

      const availableStock = stockMap.get(item.product_id) ?? 0;
      const stockResult = reduceStockForSale(availableStock, quantity, product.name);
      if (!stockResult.ok) {
        throw new Error(stockResult.error);
      }

      return { product_id: item.product_id, quantity, unit_price_cents, subtotal_cents, product_name: product.name };
    });

    const subtotal_cents = saleItems.reduce((sum, item) => sum + item.subtotal_cents, 0);
    const discount_cents = Math.round((subtotal_cents * discountPct) / 100);
    const surcharge_cents = Math.round((subtotal_cents * surchargePct) / 100);
    const total_cents = Math.max(0, subtotal_cents - discount_cents + surcharge_cents);

    interface ResolvedPayment {
    method: string;
    allocation_cents: number;
    amount_cents: number;
    received_cents: number;
    change_cents: number;
  }
  const resolvedPayments: ResolvedPayment[] = [];

  const isSplit = Array.isArray(payments) && payments.length > 0;

  if (isSplit) {
    let allocationSum = 0;
    for (const p of payments) {
      if (!isPaymentMethodId(p.method)) {
        return NextResponse.json({ error: `Medio de pago inválido: ${p.method}` }, { status: 400 });
      }
      const allocationCents = Math.max(0, Math.round(Number(p.amount) * 100));
      if (!(allocationCents > 0)) {
        return NextResponse.json({ error: 'Cada medio de pago debe tener un monto mayor a 0' }, { status: 400 });
      }
      allocationSum += allocationCents;
    }
    if (Math.abs(allocationSum - total_cents) > 1) {
      return NextResponse.json(
        { error: `El reparto del pago no cubre el total ($${(total_cents / 100).toFixed(2)} vs $${(allocationSum / 100).toFixed(2)})` },
        { status: 400 }
      );
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
        return NextResponse.json(
          { error: `El monto recibido para ${method} no puede ser menor al total del medio` },
          { status: 400 }
        );
      }
      changeCents = receivedCents - amountCents;
      resolvedPayments.push({ method, allocation_cents: allocationCents, amount_cents: amountCents, received_cents: receivedCents, change_cents: changeCents });
    }
  } else {
    if (!isPaymentMethodId(payment_method)) {
      return NextResponse.json({ error: 'Medio de pago inválido' }, { status: 400 });
    }
    const amountPaidRaw = Number(amount_paid ?? total_cents / 100);
    const amountPaidCents = Math.max(0, Math.round(amountPaidRaw * 100));
    const changeCents = Math.max(0, amountPaidCents - total_cents);

    if (payment_method !== 'cash' && amountPaidCents < total_cents) {
      return NextResponse.json({ error: 'El monto cobrado no puede ser menor al total de la venta' }, { status: 400 });
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

    const decrementStockAtomic = async (
      productId: string,
      productName: string,
      quantity: number
    ): Promise<void> => {
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

    const incrementStockAtomic = async (
      productId: string,
      quantity: number
    ): Promise<void> => {
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
        await supabaseAdmin
          .from('stock_history')
          .insert(buildStockMovement({
            tenantId: auth.tenantId,
            productId: item.product_id,
            quantity: -item.quantity,
            type: 'out',
            reason: `Venta #${sale.id.slice(0, 8)}`,
            createdBy: auth.userId,
          }));
      }

      const itemNames = saleItems.map(i => i.product_name).slice(0, 3);
      const detail = itemNames.join(', ') + (saleItems.length > 3 ? ` y ${saleItems.length - 3} más` : '');

      await createActivityLog({
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'created',
        entityType: 'sale',
        entityId: sale.id,
        details: { total_cents: finalTotalCents, items_count: saleItems.length, products: detail, folio: sale.id.slice(0, 8), payment_method: primaryMethod },
      });

      return NextResponse.json(
        {
          ...sale,
          items: itemsWithSaleId,
          payments: paymentsWithSaleId,
          adjustments_applied: isSplit
            ? Object.fromEntries(
                resolvedPayments.map((p) => [
                  p.method,
                  checkoutSettings.payment_adjustments[p.method as keyof typeof checkoutSettings.payment_adjustments],
                ])
              )
            : {},
        },
        { status: 201 }
      );
    } catch (err: unknown) {
      for (const item of decremented) {
        await incrementStockAtomic(item.product_id, item.quantity);
      }
      const message = err instanceof Error ? err.message : 'Error al procesar la venta';
      return NextResponse.json({ error: message }, { status: 400 });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error al procesar la venta';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
