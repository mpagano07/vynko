import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { createPurchaseOrder, listPurchaseOrders } from '@/lib/purchase-order-service';
import { fixResponse } from '@/lib/utils/encoding';

export async function GET(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const supplierId = new URL(request.url).searchParams.get('supplier_id');

  const result = await listPurchaseOrders(auth, supplierId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(fixResponse(result.data));
}

export async function POST(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await request.json();
  const result = await createPurchaseOrder(auth, body);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data, { status: result.status });
}