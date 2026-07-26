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

  let query = supabaseAdmin
    .from('products')
    .select('id, name, price_cents, cost');

  if (product_ids && product_ids.length > 0) {
    query = query.in('id', product_ids);
  }

  const { data: products, error: fetchError } = await query;

  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });
  if (!products || products.length === 0) {
    return NextResponse.json({ error: 'No hay productos' }, { status: 404 });
  }

  const updates = products.map((p: any) => ({
    id: p.id,
    name: p.name,
    old_price_cents: p.price_cents,
    new_price_cents: Math.round(p.price_cents * multiplier),
    old_cost: p.cost,
    new_cost: p.cost ? Math.round(p.cost * multiplier) : null,
  }));

  const errors: { id: string; name: string; error: string }[] = [];

  for (const update of updates) {
    const updateData: Record<string, any> = {
      price_cents: update.new_price_cents,
      updated_at: new Date().toISOString(),
    };
    if (update.new_cost !== null) updateData.cost = update.new_cost;

    const { error: updateError } = await supabaseAdmin
      .from('products')
      .update(updateData)
      .eq('id', update.id);

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
