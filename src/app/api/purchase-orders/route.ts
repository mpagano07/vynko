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
  const supplierId = searchParams.get('supplier_id');

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

  const { data: orders, error } = await query;

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

  return NextResponse.json(result);
}

export async function POST(request: Request) {
  const auth = await getAuthenticatedUser();
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  try {
    const body = await request.json();
    const { supplier_id, expected_date, notes, status, items } = body as {
      supplier_id: string;
      expected_date?: string;
      notes?: string;
      status?: string;
      items: { product_id: string; quantity: number; unit_cost?: number }[];
    };

    if (!supplier_id) {
      return NextResponse.json({ error: 'Debes seleccionar un proveedor' }, { status: 400 });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'El pedido debe tener al menos un producto' }, { status: 400 });
    }

    const productIds = items.map((i) => i.product_id);
    const { data: products, error: prodError } = await supabaseAdmin
      .from('products')
      .select('id, name, cost, cost_cents')
      .in('id', productIds)
      .eq('tenant_id', auth.tenantId);

    if (prodError) return NextResponse.json({ error: prodError.message }, { status: 500 });

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

    if (poError) return NextResponse.json({ error: poError.message }, { status: 400 });

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
      return NextResponse.json({ error: itemsError.message }, { status: 400 });
    }

    await createActivityLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: 'created',
      entityType: 'purchase_order',
      entityId: order.id,
      details: { folio: order.id.slice(0, 8), supplier_id, total_cents, items_count: items.length },
    });

    return NextResponse.json(order, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error al crear el pedido';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
