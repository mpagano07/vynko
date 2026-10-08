import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { getForecast } from '@/lib/forecast';
import { rateLimit } from '@/lib/rate-limit';
import { fixResponse } from '@/lib/utils/encoding';
import { trackEvent } from '@/lib/track-event';
import { logger } from '@/lib/logger';

export async function GET(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const limit = await rateLimit(`ai:forecast:${auth.tenantId}`, 30, 60 * 1000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Límite de consultas de pronóstico alcanzado. Esperá un momento.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    );
  }

  try {
    const payload = await getForecast(auth.tenantId);

    // Se graba despues de que el pronostico salio bien: opened mide que
    // la pantalla sirvio para algo, no que alguien la abrio. Si el
    // pronostico tira, entrar al paso del embudo por un error del modelo
    // seria medir un producto roto como producto usado.
    await trackEvent({
      type: 'forecast_opened',
      userId: auth.userId,
      tenantId: auth.tenantId,
    });

    return NextResponse.json(fixResponse(payload));
  } catch (err) {
    logger.error('Forecast error:', { error: err });
    return NextResponse.json({ error: 'Ocurrio un error inesperado. Intenta de nuevo.' }, { status: 500 });
  }
}
