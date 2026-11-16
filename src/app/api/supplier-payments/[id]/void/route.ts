import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { voidSupplierPayment } from '@/lib/supplier-account-service';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let body: { reason?: string } = {};
  try {
    body = (await request.json()) as { reason?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const result = await voidSupplierPayment(auth, id, body.reason || '');
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data);
}
