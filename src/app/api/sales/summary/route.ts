import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { getSalesSummary } from '@/lib/sales-service';

export async function GET(request: Request) {
  try {
    const auth = await getAuth(request);
    if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const daysParam = Number(searchParams.get('days')) || 7;

    const result = await getSalesSummary(auth, daysParam);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
    return NextResponse.json(result.data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error in sales summary';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}