import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { createSale, getTodaySales, listSales } from '@/lib/sales-service';
import { fixResponse } from '@/lib/utils/encoding';

export async function GET(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const todayOnly = searchParams.get('today') === 'true';

  if (todayOnly) {
    const tz = searchParams.get('tz') || 'UTC';
    const result = await getTodaySales(auth, tz);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
    return NextResponse.json(fixResponse(result.data));
  }

  const days = searchParams.get('days') ? parseInt(searchParams.get('days')!, 10) : null;
  const hasPagination = searchParams.has('page') || searchParams.has('limit') || days !== null;
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '15', 10)));

  const result = await listSales(auth, { days, page, limit, hasPagination });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });

  if (hasPagination) {
    return NextResponse.json(fixResponse({ data: result.data, total: result.total ?? 0, page, limit }));
  }
  return NextResponse.json(fixResponse(result.data));
}

export async function POST(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await request.json();
  const result = await createSale(auth, body);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });

  return NextResponse.json(
    {
      ...result.sale,
      items: result.items,
      payments: result.payments,
      adjustments_applied: result.adjustments_applied,
    },
    { status: 201 }
  );
}