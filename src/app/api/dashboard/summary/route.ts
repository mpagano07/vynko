import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { getDashboardSummary } from '@/lib/dashboard-service';
import { fixResponse } from '@/lib/utils/encoding';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const auth = await getAuth(request);
    if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const result = await getDashboardSummary(auth);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
    return NextResponse.json(fixResponse(result.data));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error processing summary';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}