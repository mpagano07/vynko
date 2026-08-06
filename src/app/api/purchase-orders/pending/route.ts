import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data: orders, error } = await supabaseAdmin
    .from('purchase_orders')
    .select(`
      id,
      status,
      expected_date,
      created_at,
      supplier:suppliers(name),
      items:purchase_order_items(
        quantity_ordered,
        quantity_received,
        product:products(id, name)
      )
    `)
    .eq('tenant_id', auth.tenantId)
    .in('status', ['draft', 'sent', 'partial'])
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const result = (orders ?? [])
    .map((o: Record<string, unknown>) => {
      const supplier = o.supplier as Record<string, unknown> | undefined;
      const items = ((o.items as Record<string, unknown>[] | undefined) ?? [])
        .map((i: Record<string, unknown>) => {
          const product = i.product as Record<string, unknown> | undefined;
          const ordered = Number(i.quantity_ordered) || 0;
          const received = Number(i.quantity_received) || 0;
          return {
            product_id: (product?.id as string) ?? null,
            product_name: (product?.name as string) ?? 'Producto',
            quantity_ordered: ordered,
            quantity_received: received,
            quantity_pending: Math.max(0, ordered - received),
          };
        })
        .filter((i) => i.quantity_pending > 0);

      return {
        id: o.id,
        status: o.status,
        expected_date: (o.expected_date as string | null) ?? null,
        created_at: o.created_at,
        supplier_name: (supplier?.name as string) ?? 'Proveedor',
        items,
      };
    })
    .filter((o) => o.items.length > 0);

  return NextResponse.json(result);
}
