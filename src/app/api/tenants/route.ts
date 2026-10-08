import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { createTenant } from '@/lib/tenant-service';
import { logger } from '@/lib/logger';

export async function POST(request: Request) {
  try {
    const auth = await getAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const body = await request.json();

    const result = await createTenant(auth, body);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.data);
  } catch (err) {
    logger.error('Error creating tenant:', { error: err });
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
