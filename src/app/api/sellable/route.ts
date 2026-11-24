import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { listSellableItems } from '@/lib/variant-service';
import { fixResponse } from '@/lib/utils/encoding';

export const dynamic = 'force-dynamic';

/** Catalogo comercializable del POS: productos simples + variantes, nunca el padre de variantes. */
export async function GET(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const result = await listSellableItems(auth);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(fixResponse(result.data));
}
