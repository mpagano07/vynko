import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { receivePurchaseOrder } from '@/lib/purchase-order-service';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { id } = await params;

  try {
    const body = await request.json();
    const result = await receivePurchaseOrder(auth, id, body);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.data, { status: result.status });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error al recibir pedido';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}