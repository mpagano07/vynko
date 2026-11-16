import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { createSupplierPayment, getSupplierAccount } from '@/lib/supplier-account-service';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const result = await getSupplierAccount(auth, id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  const data = result.data as { payments?: unknown[] };
  return NextResponse.json(data.payments ?? []);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const result = await createSupplierPayment(auth, id, body as any);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data, { status: result.status });
}
