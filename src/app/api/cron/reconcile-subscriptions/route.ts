import { NextResponse } from 'next/server';
import { reconcileSubscriptions } from '@/lib/mercadopago-reconcile';

export const dynamic = 'force-dynamic';

/**
 * Dispara la reconciliacion de suscripciones. Pensado para un cron (Vercel
 * Cron envia GET con `Authorization: Bearer $CRON_SECRET`).
 */
async function handle(request: Request) {
  const secret = process.env.CRON_SECRET;

  // Fail closed. Si `CRON_SECRET` no esta configurado, este endpoint queda
  // inoperable en vez de abierto: un endpoint de reconciliacion sin auth
  // permitiria a cualquiera forzar la comparacion contra la API de MP y, en el
  // peor caso, que se apliquen transiciones fuera de la cadencia prevista.
  if (!secret) {
    console.error('CRON_SECRET is not configured: reconciliation endpoint disabled');
    return NextResponse.json({ error: 'Reconciliation is not configured' }, { status: 503 });
  }

  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const report = await reconcileSubscriptions();

  return NextResponse.json(report, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
}

export async function GET(request: Request) {
  return handle(request);
}

// POST tambien, para poder dispararlo a mano desde un runbook.
export async function POST(request: Request) {
  return handle(request);
}