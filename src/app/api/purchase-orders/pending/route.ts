import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { listPendingPurchaseOrders } from '@/lib/purchase-order-service';
import { fixResponse } from '@/lib/utils/encoding';

export async function GET(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const result = await listPendingPurchaseOrders(auth);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(fixResponse(result.data));
}