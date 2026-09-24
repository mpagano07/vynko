import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { getCheckoutSettings, updateCheckoutSettings } from '@/lib/settings-service';
import type { CheckoutSettings } from '@/lib/payment-methods';

export async function GET(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const result = await getCheckoutSettings(auth);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data);
}

export async function PUT(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = (await request.json()) as Partial<CheckoutSettings>;

  const result = await updateCheckoutSettings(auth, body);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data);
}