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

export async function GET(request: Request) {
  const auth = await getAuthenticatedUser();
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const todayOnly = searchParams.get('today') === 'true';

  if (todayOnly) {
    const tz = searchParams.get('tz') || 'UTC';
    const now = new Date();
    const todayStartStr = now.toLocaleDateString('en-CA', { timeZone: tz }) + 'T00:00:00.000Z';
    const todayStart = new Date(todayStartStr);
    const { data: sales, error } = await supabaseAdmin
      .from('sales')
      .select('id, total_cents, created_at')
      .eq('tenant_id', auth.tenantId)
      .gte('created_at', todayStart.toISOString())
      .order('created_at', { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(sales ?? []);
  }

  const { data: sales, error } = await supabaseAdmin
    .from('sales')
    .select(`
      *,
      items:sale_items(
        *,
        product:products(name)
      ),
      customer:customers(name)
    `)
    .eq('tenant_id', auth.tenantId)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

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

  return NextResponse.json(result);
}

export async function POST(request: Request) {
  const auth = await getAuthenticatedUser();
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  try {
    const body = await request.json();
    const { customer_id, notes, items } = body as {
      customer_id?: string;
      notes?: string;
      items: { product_id: string; quantity: number; unit_price?: number }[];
    };

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'La venta debe tener al menos un producto' }, { status: 400 });
    }

    const productIds = items.map((i) => i.product_id);
    const { data: products, error: prodError } = await supabaseAdmin
      .from('products')
      .select('id, name, price, price_cents, stock')
      .in('id', productIds)
      .eq('tenant_id', auth.tenantId);

    if (prodError) return NextResponse.json({ error: prodError.message }, { status: 500 });

    type ProductRow = { id: string; name: string; price: number; price_cents?: number; stock: number };
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
      const unit_price_cents = item.unit_price != null
        ? Math.round(Number(item.unit_price) * 100)
        : (product.price_cents ?? Math.round(Number(product.price) * 100));
      const subtotal_cents = quantity * unit_price_cents;

      if (quantity > (product.stock ?? 0)) {
        throw new Error(`Stock insuficiente para "${product.name}" (disponible: ${product.stock})`);
      }

      return { product_id: item.product_id, quantity, unit_price_cents, subtotal_cents, product_name: product.name };
    });

    const total_cents = saleItems.reduce((sum, item) => sum + item.subtotal_cents, 0);

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

    if (saleError) return NextResponse.json({ error: saleError.message }, { status: 400 });

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
      return NextResponse.json({ error: itemsError.message }, { status: 400 });
    }

    for (const item of saleItems) {
      const product = productMap.get(item.product_id);
      const newStock = (product?.stock ?? 0) - item.quantity;

      await supabaseAdmin
        .from('products')
        .update({ stock: newStock })
        .eq('id', item.product_id);

      await supabaseAdmin
        .from('stock_history')
        .insert({
          tenant_id: auth.tenantId,
          product_id: item.product_id,
          quantity: -item.quantity,
          type: 'out',
          reason: `Venta #${sale.id.slice(0, 8)}`,
          created_by: auth.userId,
        });

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
    const message = err instanceof Error ? err.message : 'Error al procesar la venta';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
