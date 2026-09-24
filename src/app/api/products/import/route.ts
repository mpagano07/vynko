import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { importProducts } from '@/lib/product-service';

export async function POST(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await request.json();
  const result = await importProducts(auth, body?.products as Record<string, unknown>[] | undefined);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.body);
}