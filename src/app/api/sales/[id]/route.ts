import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { getSaleById } from '@/lib/sales-service';
import { fixResponse } from '@/lib/utils/encoding';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { id } = await params;

  const result = await getSaleById(auth, id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(fixResponse(result.sale));
}