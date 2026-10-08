import { NextResponse } from 'next/server';
import { reconcileSubscriptions } from '@/lib/mercadopago-reconcile';
import { enqueueJob } from '@/lib/job-queue';
import { logger } from '@/lib/logger';
import { enterLogContext, resolveRequestId } from '@/lib/log-context';

export const dynamic = 'force-dynamic';

/**
 * Dispara la reconciliacion de suscripciones. Pensado para un cron (Vercel
 * Cron envia GET con `Authorization: Bearer $CRON_SECRET`).
 */
async function handle(request: Request) {
  // Cron manual o de Vercel: el contexto no lo pone getAuth, asi que se entra
  // aca para que todo lo que loguee la reconciliacion salga taggeado con el job.
  enterLogContext({ requestId: resolveRequestId(request), job: 'reconcile-subscriptions' });
  const secret = process.env.CRON_SECRET;

  // Fail closed. Si `CRON_SECRET` no esta configurado, este endpoint queda
  // inoperable en vez de abierto: un endpoint de reconciliacion sin auth
  // permitiria a cualquiera forzar la comparacion contra la API de MP y, en el
  // peor caso, que se apliquen transiciones fuera de la cadencia prevista.
  if (!secret) {
    logger.error('CRON_SECRET is not configured: reconciliation endpoint disabled');
    return NextResponse.json({ error: 'Reconciliation is not configured' }, { status: 503 });
  }

  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const report = await reconcileSubscriptions();

    return NextResponse.json(report, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch (error) {
    // La reconciliacion revienta: algo inesperado (los fallos transitorios de
    // la API de MP ya estan atrapados adentro y se reportan como `unreachable`).
    // Sin esto, la corrida del dia se pierde y el proximo intento es en 24 h.
    // Se deja en cola y `/api/cron/process-jobs` reintenta con backoff.
    const jobId = await enqueueJob({ jobType: 'reconcile_subscriptions', payload: { source: 'cron' } });
    logger.error('reconcile-subscriptions: fallo y se dejo en cola', { jobId, error });
    return NextResponse.json({ error: 'Reconciliation failed', queued: jobId !== null }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handle(request);
}

// POST tambien, para poder dispararlo a mano desde un runbook.
export async function POST(request: Request) {
  return handle(request);
}