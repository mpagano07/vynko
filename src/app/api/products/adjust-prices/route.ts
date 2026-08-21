import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { createActivityLog } from '@/lib/activity-log';

export async function POST(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const tenantId = auth.tenantId;

  const body = await request.json();
  const { percentage, product_ids } = body as { percentage: number; product_ids?: string[] };

  if (percentage === undefined || typeof percentage !== 'number' || percentage <= 0) {
    return NextResponse.json({ error: 'Porcentaje inválido' }, { status: 400 });
  }

  const multiplier = 1 + percentage / 100;

  const scopeTenantIds = auth.allTenants ? auth.tenantIds : [tenantId];
  const { data: stockRows, error: stockError } = await supabaseAdmin
    .from('product_stock')
    .select('product_id')
    .in('tenant_id', scopeTenantIds);

  if (stockError) return NextResponse.json({ error: stockError.message }, { status: 500 });

  const tenantProductIds = new Set((stockRows ?? []).map((row) => row.product_id as string));
  const allowedIds = product_ids && product_ids.length > 0
    ? product_ids.filter((id) => tenantProductIds.has(id))
    : Array.from(tenantProductIds);

  if (allowedIds.length === 0) {
    return NextResponse.json({ error: 'No hay productos' }, { status: 404 });
  }

  const { data: products, error: fetchError } = await supabaseAdmin
    .from('products')
    .select('id, name, price_cents, cost')
    .in('id', allowedIds);

  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });
  if (!products || products.length === 0) {
    return NextResponse.json({ error: 'No hay productos' }, { status: 404 });
  }

  const updates = products.map((p) => ({
    id: p.id,
    name: p.name,
    old_price_cents: p.price_cents,
    new_price_cents: Math.round(p.price_cents * multiplier),
    old_cost: p.cost,
    new_cost: p.cost ? Math.round(p.cost * multiplier) : null,
  }));

  const errors: { id: string; name: string; error: string }[] = [];

  for (const update of updates) {
    const updateData: Record<string, unknown> = {
      price_cents: update.new_price_cents,
      updated_at: new Date().toISOString(),
    };
    if (update.new_cost !== null) updateData.cost = update.new_cost;

    const { error: updateError } = await supabaseAdmin
      .from('products')
      .update(updateData)
      .eq('id', update.id)
      .in('id', allowedIds);

    if (updateError) {
      errors.push({ id: update.id, name: update.name, error: updateError.message });
    }
  }

  await createActivityLog({
    tenantId,
    userId: auth.userId,
    action: 'adjusted',
    entityType: 'product',
    details: { percentage, total: updates.length, updated: updates.length - errors.length },
  });

  return NextResponse.json({
    success: errors.length === 0,
    percentage,
    total: updates.length,
    updated: updates.length - errors.length,
    errors: errors.length > 0 ? errors : undefined,
    sample: updates.slice(0, 5),
  });
}
