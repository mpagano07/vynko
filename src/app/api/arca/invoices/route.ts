import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { listElectronicInvoices, createElectronicInvoice } from '@/lib/arca-service';
import { fixResponse } from '@/lib/utils/encoding';

export async function GET(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : 50;
  const offset = searchParams.get('offset') ? parseInt(searchParams.get('offset')!, 10) : 0;
  const status = searchParams.get('status') || undefined;

  const result = await listElectronicInvoices(auth, { limit, offset, status });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(fixResponse(result.data));
}

export async function POST(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const body = await request.json();
  const result = await createElectronicInvoice(auth, body);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data, { status: result.status });
}
