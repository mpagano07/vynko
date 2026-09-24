import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { getCriticalProducts } from '@/lib/product-service';
import { fixResponse } from '@/lib/utils/encoding';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const result = await getCriticalProducts(auth);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json(fixResponse(result.products));
}