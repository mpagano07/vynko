import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { getAccountCutoffDate, setAccountCutoffDate } from '@/lib/supplier-account-service';

export async function GET(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const cutoff = await getAccountCutoffDate(auth.tenantId);
  return NextResponse.json({ cutoff_date: cutoff });
}

export async function PATCH(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let body: { cutoff_date?: string | null } = {};
  try {
    body = (await request.json()) as { cutoff_date?: string | null };
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const result = await setAccountCutoffDate(auth, body.cutoff_date ?? null);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data);
}
