import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { getStockHistory } from '@/lib/stock-history-service';
import { fixResponse } from '@/lib/utils/encoding';

export async function GET(request: NextRequest) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const result = await getStockHistory(auth, {
    limit: searchParams.get('limit'),
    offset: searchParams.get('offset'),
    type: searchParams.get('type'),
    product_id: searchParams.get('product_id'),
    days: searchParams.get('days'),
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(fixResponse(result.data));
}