import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { exportAccountData } from '@/lib/account-service';

export async function GET(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const result = await exportAccountData(auth);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(result.data, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="vynko-datos-${stamp}.json"`,
      'Cache-Control': 'no-store',
    },
  });
}
