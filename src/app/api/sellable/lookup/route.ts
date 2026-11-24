import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { lookupSellableByCode } from '@/lib/variant-service';
import { fixResponse } from '@/lib/utils/encoding';

export const dynamic = 'force-dynamic';

/** Resuelve SKU o barcode a un único SellableItem del tenant (simple o variante). */
export async function GET(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const code = new URL(request.url).searchParams.get('code') ?? '';
  const result = await lookupSellableByCode(auth, code);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(fixResponse(result.data));
}
