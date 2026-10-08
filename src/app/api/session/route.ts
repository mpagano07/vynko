import { NextResponse } from 'next/server';
import { getSessionData } from '@/lib/session-service';
import { logger } from '@/lib/logger';

export async function GET(request: Request) {
  try {
    const result = await getSessionData(request);
    return NextResponse.json(result.data);
  } catch (error) {
    logger.error('Error in GET /api/session:', { error });
    return NextResponse.json(
      // Mismo shape que la sesion vacia, mas `error`. `role` va incluido por el
      // mismo motivo: el cliente lee `data.role` y no debe obtener `undefined`
      // en el camino de error y `null` en el de "sesion vacia".
      {
        user: null,
        profile: null,
        tenant: null,
        tenants: [],
        role: null,
        onboarding_pending: true,
        error: 'Internal server error',
      },
      { status: 500 }
    );
  }
}
