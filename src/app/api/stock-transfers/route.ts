import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { createActivityLog } from '@/lib/activity-log';

export async function GET(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get('status');

  let q = supabaseAdmin
    .from('stock_transfers')
    .select(`
      *,
      items:stock_transfer_items(
        *,
        product:products(name)
      )
    `);

  if (auth.allTenants) {
    if (statusFilter) {
      q = q.eq('status', statusFilter);
    }
  } else {
    const filter = `from_tenant_id.eq.${auth.tenantId},to_tenant_id.eq.${auth.tenantId}`;
    q = q.or(filter);
    if (statusFilter) {
      q = q.eq('status', statusFilter);
    }
  }

  q = q.order('created_at', { ascending: false });

  const { data, error } = await q;
  if (error) {
    { console.error('DB error:', error); return NextResponse.json({ error: 'Ocurrio un error inesperado. Intenta de nuevo.' }, { status: 500 }); }
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

  const tenantMap = new Map((tenants || []).map(t => [t.id, t.name]));

  const userIds = new Set((data || []).map(t => t.created_by));
  const { data: profiles } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name')
    .in('id', [...userIds]);

  const userMap = new Map((profiles || []).map(p => [p.id, p.full_name]));

  const result = (data || []).map(t => ({
    ...t,
    from_tenant_name: tenantMap.get(t.from_tenant_id) || 'Desconocido',
    to_tenant_name: tenantMap.get(t.to_tenant_id) || 'Desconocido',
    created_by_name: userMap.get(t.created_by) || 'Usuario',
    items: (t.items || []).map((item: Record<string, unknown>) => {
      const product = item.product as Record<string, unknown> | undefined;
      return { ...item, product_name: product?.name ?? null };
    }),
  }));

  return NextResponse.json(result);
}

export async function POST(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await request.json();
  const { from_tenant_id, to_tenant_id, notes, items } = body;

  if (!from_tenant_id || !to_tenant_id) {
    return NextResponse.json({ error: 'Origen y destino son requeridos' }, { status: 400 });
  }

  if (from_tenant_id === to_tenant_id) {
    return NextResponse.json({ error: 'Origen y destino deben ser diferentes' }, { status: 400 });
  }

  if (!items || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'Debe incluir al menos un producto' }, { status: 400 });
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
    return NextResponse.json({ error: transferError ? 'Error al crear la transferencia' : 'Error al crear transferencia' }, { status: 400 });
  }

  const transferItems = items.map((item: Record<string, unknown>) => ({
    transfer_id: transfer.id,
    product_id: item.product_id,
    quantity: item.quantity,
  }));

  const { error: itemsError } = await supabaseAdmin
    .from('stock_transfer_items')
    .insert(transferItems);

  if (itemsError) {
    await supabaseAdmin.from('stock_transfers').delete().eq('id', transfer.id);
    { console.error('DB error:', itemsError); return NextResponse.json({ error: 'Ocurrio un error inesperado. Intenta de nuevo.' }, { status: 400 }); }
  }

  await createActivityLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: 'created',
    entityType: 'stock_transfer',
    entityId: transfer.id,
    details: { from_tenant_id, to_tenant_id, items_count: items.length },
  });

  return NextResponse.json(transfer, { status: 201 });
}
