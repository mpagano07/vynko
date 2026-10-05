import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { createActivityLog } from '@/lib/activity-log';
import { reduceStockForSale } from '@/lib/stock';
import { isPaymentMethodId, normalizeCheckoutSettings } from '@/lib/payment-methods';
import type { AuthInfo } from '@/lib/api-auth';
import { trackEvent } from '@/lib/track-event';
import { scheduleAfterBackground } from '@/lib/after-background';

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

export type GetSaleResult =
  | { ok: true; sale: Record<string, unknown> }
  | { ok: false; error: string; status: number };

export async function getSaleById(auth: AuthInfo, id: string): Promise<GetSaleResult> {
  const { data: sale, error } = await supabaseAdmin
    .from('sales')
    .select(`
      *,
      items:sale_items(
        *,
        product:products(name)
      ),
      customer:customers(name)
    `)
    .eq('id', id)
    .eq('tenant_id', auth.tenantId)
    .single();

  if (error) {
    console.error('DB error:', error);
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 404 };
  }

  return { ok: true, sale: flattenSale(sale as Record<string, unknown>) };
}

async function getMonthTotals(tenantIds: string[], monthStart: Date) {
  const month = monthStart.toISOString().slice(0, 10);

  const query = supabaseAdmin
    .from('sales_monthly_totals')
    .select('total, sale_count')
    .eq('month', month)
    .in('tenant_id', tenantIds);

  const res = (await query) as unknown as {
    data: Array<{ total: number; sale_count: number }> | null;
    error: { message: string } | null;
  };
  const { data, error } = res;
  if (error) return { error };
  const row = data?.[0];
  return {
    total: (row?.total as number) || 0,
    count: (row?.sale_count as number) || 0,
  };
}

export type MonthlySalesResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string };

export async function getMonthlySales(auth: AuthInfo): Promise<MonthlySalesResult> {
  try {
    const scopeTenantIds = auth.allTenants ? auth.tenantIds : [auth.tenantId];

    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const [thisMonth, prevMonth] = await Promise.all([
      getMonthTotals(scopeTenantIds, thisMonthStart),
      getMonthTotals(scopeTenantIds, prevMonthStart),
    ]);

    if (thisMonth.error) { console.error('DB error:', thisMonth.error); return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.' }; }
    if (prevMonth.error) { console.error('DB error:', prevMonth.error); return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.' }; }

    const thisTotal = thisMonth.total / 100;
    const prevTotal = prevMonth.total / 100;
    const thisCount = thisMonth.count;
    const prevCount = prevMonth.count;

    const variationPercent = prevTotal > 0
      ? Math.round(((thisTotal - prevTotal) / prevTotal) * 100)
      : null;

    const avgTicket = thisCount > 0 ? thisTotal / thisCount : 0;

    return {
      ok: true,
      data: {
        total: thisTotal,
        saleCount: thisCount,
        prevTotal,
        prevSaleCount: prevCount,
        variationPercent,
        avgTicket,
      },
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error in monthly sales';
    return { ok: false, error: msg };
  }
}

const SHORT_DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const SHORT_MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const LONG_MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

export type SalesSummaryResult =
  | { ok: true; data: Record<string, unknown>[] }
  | { ok: false; error: string };

export async function getSalesSummary(auth: AuthInfo, daysParam: number): Promise<SalesSummaryResult> {
  try {
    const tenantId = auth.tenantId;
    const scopeTenantIds = auth.allTenants ? auth.tenantIds : [tenantId];

    const days = [7, 30, 90, 365].includes(daysParam) ? daysParam : 7;

    const since = new Date();
    since.setDate(since.getDate() - (days - 1));
    since.setHours(0, 0, 0, 0);
    const sinceDay = since.toISOString().slice(0, 10);

    const sQuery = supabaseAdmin
      .from('sales_daily_totals')
      .select('day, total')
      .gte('day', sinceDay)
      .in('tenant_id', scopeTenantIds);
    const res = (await sQuery) as unknown as {
      data: Array<{ day: string; total: number }> | null;
      error: { message: string } | null;
    };
    const { data: grouped, error } = res;

    if (error) { console.error('DB error:', error); return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.' }; }

    const dailyTotals: Record<string, number> = {};
    for (let i = 0; i < days; i++) {
      const date = new Date();
      date.setDate(date.getDate() - (days - 1 - i));
      const key = date.toISOString().slice(0, 10);
      dailyTotals[key] = 0;
    }

    for (const row of (grouped ?? [])) {
      const day = String(row.day as string).slice(0, 10);
      if (dailyTotals[day] !== undefined) {
        dailyTotals[day] += (row.total as number) || 0;
      }
    }

    const formatted = Object.entries(dailyTotals).map(([date, total]) => {
      const d = new Date(date + 'T12:00:00');
      let label: string;
      if (days <= 31) {
        label = SHORT_DAYS[d.getDay()];
      } else {
        label = `${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}`;
      }
      return {
        date,
        day: label,
        total: total / 100,
      };
    });

    return { ok: true, data: formatted };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error in sales summary';
    return { ok: false, error: msg };
  }
}

export type SalesMonthlySummaryResult =
  | { ok: true; data: Record<string, unknown>[] }
  | { ok: false; error: string };

// Agregación mensual para la ventana de 12 meses del gráfico del dashboard. Con
// 365 barras diarias el eje queda ilegible y no se puede comparar mes contra mes,
// así que esa ventana devuelve una barra por mes con la suma completa del mes
// (incluido el mes en curso, que la UI marca como parcial).
// El agrupado por mes lo hace la vista `sales_monthly_totals`; aca solo se arman
// los buckets (incluyendo meses sin ventas) y se formatean las etiquetas.
export async function getSalesMonthlySummary(auth: AuthInfo): Promise<SalesMonthlySummaryResult> {
  try {
    const scopeTenantIds = auth.allTenants ? auth.tenantIds : [auth.tenantId];

    // La ventana es siempre de 12 meses: es la unica que pide la UI y la vista
    // mensual no conviene para rangos arbitrarios, asi que el parametro se
    // acepta (para distinguir el modo) pero cualquier valor cae en 12.
    const months = 12;

    // La vista usa date_trunc('month', created_at), es decir UTC; los cortes de
    // mes se arman en UTC para que el bucket coincida con el de la base.
    const now = new Date();
    const buckets: Array<{ month: string; total: number; saleCount: number }> = [];
    for (let i = months - 1; i >= 0; i--) {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      buckets.push({ month: start.toISOString().slice(0, 10), total: 0, saleCount: 0 });
    }
    const sinceMonth = buckets[0].month;

    const query = supabaseAdmin
      .from('sales_monthly_totals')
      .select('month, total, sale_count')
      .gte('month', sinceMonth)
      .in('tenant_id', scopeTenantIds);
    const res = (await query) as unknown as {
      data: Array<{ month: string; total: number; sale_count: number }> | null;
      error: { message: string } | null;
    };
    const { data: grouped, error } = res;

    if (error) { console.error('DB error:', error); return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.' }; }

    const byMonth = new Map(buckets.map((b) => [b.month, b]));
    for (const row of (grouped ?? [])) {
      const bucket = byMonth.get(String(row.month as string).slice(0, 10));
      if (!bucket) continue;
      bucket.total += (row.total as number) || 0;
      bucket.saleCount += (row.sale_count as number) || 0;
    }

    const lastIndex = buckets.length - 1;
    const data = buckets.map((b, i) => {
      const d = new Date(b.month + 'T12:00:00Z');
      return {
        date: b.month,
        day: SHORT_MONTHS[d.getUTCMonth()],
        label: `${LONG_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
        partial: i === lastIndex,
        saleCount: b.saleCount,
        total: b.total / 100,
      };
    });

    return { ok: true, data };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error in sales monthly summary';
    return { ok: false, error: msg };
  }
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
  // `price_cents` es la unica fuente de precio. `price` (pesos) no se pide: es
  // legacy, quedo en 0 para la mayoria del catalogo y usarla seria vender a $0.
  price_cents?: number | null;
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

  const [
    { data: tenantRow },
    { data: openSession },
    customerRes,
    { data: products, error: prodError },
    { data: stockRows, error: stockError }
  ] = await Promise.all([
    supabaseAdmin.from('tenants').select('settings').eq('id', auth.tenantId).maybeSingle(),
    supabaseAdmin
      .from('cash_register_sessions')
      .select('id')
      .eq('tenant_id', auth.tenantId)
      .eq('status', 'open')
      .maybeSingle(),
    customer_id
      ? supabaseAdmin
          .from('customers')
          .select('id')
          .eq('id', customer_id)
          .eq('tenant_id', auth.tenantId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabaseAdmin
      .from('products')
      .select('id, name, price_cents')
      .in('id', productIds),
    supabaseAdmin
      .from('product_stock')
      .select('product_id, stock')
      .in('product_id', productIds)
      .eq('tenant_id', auth.tenantId)
  ]);

  const checkoutSettings = normalizeCheckoutSettings(
    (tenantRow?.settings as Record<string, unknown> | undefined)?.checkout
  );
  const sessionId = openSession?.id ?? null;

  if (customer_id && !customerRes.data) {
    return { ok: false, error: 'El cliente no pertenece a esta sucursal', status: 400 };
  }

  if (prodError || stockError) {
    console.error('DB error fetching products/stock:', prodError || stockError);
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
  }

  const stockMap = new Map((stockRows ?? []).map((s) => [s.product_id, s.stock ?? 0]));

  // `products` es global: la consulta de arriba trae tambien los productos que
  // solo existen para otra empresa. El filtro que decide es `product_stock`, y
  // tiene que ocurrir ANTES de usar el nombre del producto en ningun mensaje:
  // despues, el error de stock insuficiente decia "Stock insuficiente para
  // <nombre de B>", delatando el catalogo ajeno.
  const knownIds = new Set((products ?? []).map((p) => p.id as string));
  const unknownId = productIds.find((id) => !knownIds.has(id));
  if (unknownId) {
    return { ok: false, error: `Producto no encontrado: ${unknownId}`, status: 400 };
  }
  if (productIds.some((id) => !stockMap.has(id))) {
    return { ok: false, error: 'Uno o mas productos no pertenecen a esta sucursal', status: 400 };
  }

  const productMap = new Map((products ?? []).map((p) => [p.id, p as unknown as ProductRow]));

  try {
  const saleItems: SaleItemData[] = items.map((item) => {
    const product = productMap.get(item.product_id);
    if (!product) throw new Error(`Producto no encontrado: ${item.product_id}`);

    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error(`La cantidad de "${product.name}" debe ser un número entero mayor a 0`);
    }
    // El precio sale de `price_cents`, que es la unica columna que el producto
    // escribe hoy: `product-service` guarda `price_cents = round(price * 100)` y
    // la columna `price` en pesos quedo en su default 0 para 163 de los productos
    // de la base. La API de productos tampoco lee `price`: lo deriva de
    // `price_cents` (product-service.ts:159), asi que el carrito muestra el
    // precio correcto aunque la columna siga en 0.
    //
    // Por eso el fallback a `price` es una trampa: si `price_cents` alguna vez
    // llega en NULL, `price` tambien es 0 y la venta se registra a $0.00 con un
    // 201 adelante. No es un precio barato, es una venta sin facturar. Se
    // rechaza en vez de vender gratis, que es el unico resultado defendible.
    if (product.price_cents == null) {
      throw new Error(
        `El producto "${product.name}" no tiene precio de venta cargado. Cargale un precio antes de venderlo.`
      );
    }
    const unit_price_cents = product.price_cents;
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
  // El ajuste por medio de pago es una promoción sobre la venta completa
  // ("10% off si pagás todo en efectivo"), no un recargo sobre una porción.
  // Solo se aplica cuando la venta se cobra con UN medio: al repartir el pago se
  // pierde, porque si no alcanza con partir el pago en dos para conservar parte
  // del descuento y el total cobrado deja de ser predecible.
  const adjustmentsApply = !isSplit || payments.length === 1;
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
      const adjustmentPct = adjustmentsApply ? checkoutSettings.payment_adjustments[method] ?? 0 : 0;
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
    // Un cliente que cobra por API sin mandar `payments` obtiene el mismo
    // tratamiento que el modal: el ajuste del medio tambien se le aplica.
    const method = payment_method as keyof typeof checkoutSettings.payment_adjustments;
    const adjustmentPct = checkoutSettings.payment_adjustments[method] ?? 0;
    const amountCents = Math.round((total_cents * (100 + adjustmentPct)) / 100);
    const amountPaidRaw = Number(amount_paid ?? amountCents / 100);
    const amountPaidCents = Math.max(0, Math.round(amountPaidRaw * 100));
    const changeCents = Math.max(0, amountPaidCents - amountCents);

    if (payment_method !== 'cash' && amountPaidCents < amountCents) {
      return { ok: false, error: 'El monto cobrado no puede ser menor al total de la venta', status: 400 };
    }

    resolvedPayments.push({
      method: payment_method,
      allocation_cents: total_cents,
      amount_cents: amountCents,
      received_cents: amountPaidCents,
      change_cents: changeCents,
    });
  }

  // El total de la venta es lo que se cobra NETO de los ajustes por medio de
  // pago: con `cash: -10` una venta de $250 se registra y se suma al cajon
  // como $225.
  const finalTotalCents = resolvedPayments.reduce((sum, p) => sum + p.amount_cents, 0);
  // El ajuste por medio de pago no se persistia en ningun lado, asi que al
  // recargar la venta se veian items por $250, sin descuento, con total $225.
  // Se lo absorbe en discount/surcharge para que el registro sea explicable y
  // se mantenga la identidad: subtotal - descuento + recargo === total.
  const paymentAdjustmentCents = finalTotalCents - total_cents;
  const recorded_discount_cents =
    discount_cents + Math.max(0, -paymentAdjustmentCents);
  const recorded_surcharge_cents =
    surcharge_cents + Math.max(0, paymentAdjustmentCents);
  const amountPaidCents = resolvedPayments.reduce((sum, p) => sum + p.received_cents, 0);
  const changeCents = resolvedPayments.reduce((sum, p) => sum + p.change_cents, 0);
  const primaryMethod = resolvedPayments[0].method;
  const paymentRows = resolvedPayments.map((p) => ({
    method: p.method,
    amount_cents: p.amount_cents,
    received_cents: p.received_cents,
    change_cents: p.change_cents,
  }));

  // El `stockMap` de arriba alcanza para RECHAZAR la venta antes de escribir
  // nada (fail fast), pero no para descontar: cuando 20 ventas compiten por el
  // mismo producto ese valor ya quedo viejo. El descuento lo hace
  // `decrement_stock` (migracion 043), que hace el check y el write en una
  // sola sentencia bajo el lock de fila.
  //
  // Antes esto era un compare-and-swap desde JS con 5 reintentos. Con N ventas
  // sobre la misma fila, Postgres serializa los UPDATE: todos los SELECT devuelven
  // el mismo stock y solo uno gana la primera ronda, asi que los unlucky tienen
  // que reintentar y las rondas necesarias crecen con la concurrencia. Medido
  // con scripts/load-test-sales.mjs, 7 de 20 ventas concurrentes fallaban con
  // "Demasiada concurrencia" teniendo stock de sobra. Ese 400 no era una
  // validacion de stock ni un problema de lentitud: era el retry rindiendose.
  const decrementStockAtomic = async (productId: string, productName: string, quantity: number): Promise<void> => {
    const { data, error } = await supabaseAdmin.rpc('decrement_stock', {
      p_product_id: productId,
      p_tenant_id: auth.tenantId,
      p_quantity: quantity,
    });

    if (error) {
      // Un error de la RPC es infraestructura (permisos, conexion), no un
      // conflicto de stock: no se debe reportar como "vende otra vez".
      console.error('decrement_stock fallo:', error);
      throw new Error('Ocurrio un error inesperado. Intenta de nuevo.');
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (row?.ok) return;

    if (row?.stock === null || row?.stock === undefined) {
      throw new Error(`Stock insuficiente para "${productName}"`);
    }
    throw new Error(`Stock insuficiente para "${productName}" (disponible: ${row.stock})`);
  };

  // El rollback no puede arrancar desde el stock que se leyo al inicio de la
  // venta: mientras tanto otras ventas pudieron moverlo. `increment_stock`
  // (migracion 043) suma en una sola sentencia, asi que no hay compare-and-swap
  // que reintentar ni una ventana en la que el stock se pierda en silencio.
  const incrementStockAtomic = async (productId: string, quantity: number): Promise<void> => {
    const { error } = await supabaseAdmin.rpc('increment_stock', {
      p_product_id: productId,
      p_tenant_id: auth.tenantId,
      p_quantity: quantity,
    });
    // Un fallo aca deja el stock descontado sin venta: hay que dejarlo logged.
    if (error) console.error(`No se pudo restituir el stock de ${productId}:`, error);
  };

  const decremented: SaleItemData[] = [];
  try {
    // Secuencial a proposito. Con 50 ventas concurrentes el cuello de botella es
    // el lock de fila sobre `product_stock`, no el round trip: paralelizar los
    // items de UNA venta no acorta la espera por ese lock y agrega contension.
    // En este orden, si un item falla los anteriores ya quedaron en
    // `decremented` y el catch los devuelve: el rollback es exacto.
    for (const item of saleItems) {
      await decrementStockAtomic(item.product_id, item.product_name, item.quantity);
      decremented.push(item);
    }

    // Las 4 escrituras de la venta (venta, pagos, items y movimientos de stock)
    // van en UNA sola llamada a `create_sale_atomic` (migracion 045).
    //
    // Antes eran 3 + N viajes secuenciales: insert de venta, select para traer
    // el id, insert de pagos, insert de items y un insert de stock_history por
    // item. Con 20 items, 23 viajes en el camino que el cajero esta mirando.
    //
    // Ademas el rollback era a mano: un `delete` compensatorio sobre `sales` si
    // fallaba `sale_payments` o `sale_items`. Eso deja una ventana en la que la
    // venta existe y despues no, y ademas el `delete` podia fallar y dejar una
    // venta huerfana sin explicacion. Adentro de la funcion la transaccion la
    // garantiza Postgres.
    const { data: createdSale, error: createSaleError } = await supabaseAdmin.rpc('create_sale_atomic', {
      p_tenant_id: auth.tenantId,
      p_sold_by: auth.userId,
      p_total_cents: finalTotalCents,
      p_customer_id: customer_id || null,
      p_status: 'completed',
      p_notes: notes || null,
      p_payment_method: primaryMethod,
      p_amount_paid_cents: amountPaidCents,
      p_change_cents: changeCents,
      p_discount_cents: recorded_discount_cents,
      p_surcharge_cents: recorded_surcharge_cents,
      p_session_id: sessionId,
      p_payments: paymentRows,
      p_items: saleItems.map((item) => ({
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price_cents: item.unit_price_cents,
        subtotal_cents: item.subtotal_cents,
      })),
      // El motivo del movimiento se arma dentro de la funcion, que es el unico
      // lugar donde ya existe el id de venta para el folio.
      p_stock_movements: saleItems.map((item) => ({
        product_id: item.product_id,
        quantity: -item.quantity,
        type: 'out',
        created_by: auth.userId,
      })),
    });

    const sale = createdSale as { id: string } | null;
    if (!sale?.id) {
      console.error('create_sale_atomic no devolvio la venta:', createSaleError);
      throw new Error(createSaleError?.message ?? 'No se pudo registrar la venta');
    }

    // Lo que devuelve la respuesta se arma desde los datos de entrada: la
    // funcion devuelve la fila de `sales`, pero el contrato de `createSale` (y
    // lo que el front ya consume) espera items y payments con `sale_id`.
    const paymentsWithSaleId = paymentRows.map((p) => ({
      sale_id: sale.id,
      tenant_id: auth.tenantId,
      ...p,
    }));
    const itemsWithSaleId = saleItems.map((item) => ({
      sale_id: sale.id,
      product_id: item.product_id,
      quantity: item.quantity,
      unit_price_cents: item.unit_price_cents,
      subtotal_cents: item.subtotal_cents,
    }));

    const itemNames = saleItems.map((i) => i.product_name).slice(0, 3);
    const detail = itemNames.join(', ') + (saleItems.length > 3 ? ` y ${saleItems.length - 3} más` : '');

    // Auditoria y analytics salen del path critico con `after()`.
    //
    // Antes se awaited cada uno, asi que la venta no respondia hasta que el
    // log y el evento estaban escritos. Peor: si cualquiera de los dos fallaba,
    // la excepcion caia en el catch de abajo, que devuelve el stock de TODOS los
    // items. O sea, un problema de auditoria reventaba una venta que si se habia
    // registrado en `sales`: el cashier veia un error y el stock volvia, pero la
    // venta existia. Ademas son 2 round trips extra en el camino que el usuario
    // esta mirando.
    scheduleAfterBackground(async () => {
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
    });

    // Solo se asientan los ajustes que efectivamente se aplicaron: con el pago
    // dividido no se aplico ninguno, asi que el ticket no debe anunciar un
    // descuento que no existe.
    const adjustments_applied = Object.fromEntries(
      resolvedPayments.map((p) => [
        p.method,
        adjustmentsApply
          ? checkoutSettings.payment_adjustments[p.method as keyof typeof checkoutSettings.payment_adjustments] ?? 0
          : 0,
      ])
    );

    scheduleAfterBackground(async () => {
      await trackEvent({
        type: 'first_sale',
        userId: auth.userId,
        tenantId: auth.tenantId,
        metadata: { saleId: sale.id, totalCents: finalTotalCents, itemCount: saleItems.length },
      });
    });

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