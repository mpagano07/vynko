import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { createActivityLog } from '@/lib/activity-log';
import { reduceStockForSale, buildStockMovement } from '@/lib/stock';

export async function GET(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const todayOnly = searchParams.get('today') === 'true';

  if (todayOnly) {
    const tz = searchParams.get('tz') || 'UTC';
    const now = new Date();
    const todayStartStr = now.toLocaleDateString('en-CA', { timeZone: tz }) + 'T00:00:00.000Z';
    const todayStart = new Date(todayStartStr);
    let query = supabaseAdmin
      .from('sales')
      .select('id, total_cents, created_at')
      .gte('created_at', todayStart.toISOString())
      .order('created_at', { ascending: false });
    if (!auth.allTenants) query = query.eq('tenant_id', auth.tenantId);
    const { data: sales, error } = await query;

    if (error) { console.error('DB error:', error); return NextResponse.json({ error: 'Ocurrio un error inesperado. Intenta de nuevo.' }, { status: 500 }); }
    return NextResponse.json(sales ?? []);
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
    return NextResponse.json({ data: result, total: count ?? 0, page, limit });
  }
  return NextResponse.json(result);
}

export async function POST(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  try {
    const body = await request.json();
    const { customer_id, notes, items } = body as {
      customer_id?: string;
      notes?: string;
      items: { product_id: string; quantity: number }[];
    };

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

    const total_cents = saleItems.reduce((sum, item) => sum + item.subtotal_cents, 0);

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
          total_cents,
          status: 'completed',
          notes: notes || null,
          sold_by: auth.userId,
        })
        .select()
        .single();

      if (saleError) throw new Error('No se pudo registrar la venta');

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
        details: { total_cents, items_count: saleItems.length, products: detail, folio: sale.id.slice(0, 8) },
      });

      return NextResponse.json({ ...sale, items: itemsWithSaleId }, { status: 201 });
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
