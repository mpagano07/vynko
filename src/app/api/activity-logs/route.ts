import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { getActivityLogs } from '@/lib/activity-logs-service';
import { fixResponse } from '@/lib/utils/encoding';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const auth = await getAuth(request);
    if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const result = await getActivityLogs(auth, {
      limit: searchParams.get('limit'),
      offset: searchParams.get('offset'),
      entity_type: searchParams.get('entity_type'),
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(fixResponse(result.data));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error in activity logs';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}