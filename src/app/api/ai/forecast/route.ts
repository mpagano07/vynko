import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { getForecast } from '@/lib/forecast';
import { rateLimit } from '@/lib/rate-limit';
import { fixResponse } from '@/lib/utils/encoding';

export async function GET(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const limit = rateLimit(`ai:forecast:${auth.tenantId}`, 30, 60 * 1000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Límite de consultas de pronóstico alcanzado. Esperá un momento.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    );
  }

  try {
    const payload = await getForecast(auth.tenantId);
    return NextResponse.json(fixResponse(payload));
  } catch (err) {
    console.error('Forecast error:', err);
    return NextResponse.json({ error: 'Ocurrio un error inesperado. Intenta de nuevo.' }, { status: 500 });
  }
}