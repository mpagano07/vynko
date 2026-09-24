import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { closeCashRegister } from '@/lib/cash-register-service';

export async function POST(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const id = request.url.split('/').at(-2) ?? '';
  const body = await request.json().catch(() => ({}));

  const result = await closeCashRegister(auth, id, body);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data);
}