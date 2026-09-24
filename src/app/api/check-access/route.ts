import { NextResponse } from 'next/server';
import { checkAccess } from '@/lib/check-access-service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const result = await checkAccess(request);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data);
}