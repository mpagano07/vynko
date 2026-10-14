import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { testArcaConnection } from '@/lib/arca-service';
import { fixResponse } from '@/lib/utils/encoding';

export async function POST(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const result = await testArcaConnection(auth);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(fixResponse(result.data));
}
