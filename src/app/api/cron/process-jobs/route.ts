import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { enterLogContext, resolveRequestId } from '@/lib/log-context';
import { registerJobHandlers } from '@/lib/job-handlers';
import { runDueJobs } from '@/lib/job-queue';

export const dynamic = 'force-dynamic';

/**
 * Gorra de la cola de trabajos de fondo (056).
 *
 * Reclama los trabajos vencidos (`claim_background_jobs`, atomico), ejecuta el
 * handler de cada uno y devuelve como quedaron. Vercel Cron lo llama cada
 * poco; POST sirve para dispararlo a mano desde el runbook.
 *
 * Si la base no responde responde 500 a proposito: una corrida de cron que
 * devuelve 200 con "0 trabajos" deja la cola parada sin que se vea en el
 * historial de Vercel.
 */
async function handle(request: Request) {
  enterLogContext({ requestId: resolveRequestId(request), job: 'process-jobs' });
  const secret = process.env.CRON_SECRET;

  // Fail closed, igual que el cron de reconciliacion: sin secreto el endpoint
  // queda inoperable. Procesar la cola sin auth permitiria a cualquiera
  // disparar trabajos (y observar los payloads) con la anon key.
  if (!secret) {
    logger.error('CRON_SECRET is not configured: job processor disabled');
    return NextResponse.json({ error: 'Job processor is not configured' }, { status: 503 });
  }

  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  registerJobHandlers();

  try {
    const report = await runDueJobs();
    return NextResponse.json(report, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch (error) {
    logger.error('process-jobs: no se pudo reclamar la cola', { error });
    return NextResponse.json({ error: 'Could not process the queue' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handle(request);
}

// POST tambien, para poder dispararlo a mano desde un runbook.
export async function POST(request: Request) {
  return handle(request);
}
