import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { getMonthlySales } from '@/lib/sales-service';

export async function GET(request: Request) {
  try {
    const auth = await getAuth(request);
    if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const result = await getMonthlySales(auth);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
    return NextResponse.json(result.data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error in monthly sales';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}