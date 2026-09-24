import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { updatePurchaseOrder } from '@/lib/purchase-order-service';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await request.json();
  const result = await updatePurchaseOrder(auth, id, body);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data);
}