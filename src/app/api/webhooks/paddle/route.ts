import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { verifyPaddleSignature } from '@/lib/paddle';
import { processPaddleWebhook, type PaddleEvent } from '@/lib/paddle-webhook-service';
import { logger } from '@/lib/logger';
import { enterLogContext, resolveRequestId } from '@/lib/log-context';

export async function POST(request: Request) {
  // El webhook no pasa por getAuth: el contexto se entra acá para que cada log
  // del procesamiento quede amarrado a la entrega de Paddle.
  enterLogContext({ requestId: resolveRequestId(request), job: 'paddle-webhook' });

  // El cuerpo crudo es lo que se firma: hay que leerlo como texto y validar la
  // firma ANTES de parsearlo (re-serializar cambiaría los bytes firmados).
  const rawText = await request.text();
  const signature = request.headers.get('paddle-signature');

  if (!verifyPaddleSignature(rawText, signature)) {
    logger.error('Invalid Paddle webhook signature', { requestId: resolveRequestId(request) });
    return NextResponse.json({ error: 'Unauthorized webhook request' }, { status: 401 });
  }

  let event: PaddleEvent;
  try {
    event = JSON.parse(rawText) as PaddleEvent;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!event?.event_id) {
    return NextResponse.json({ error: 'Missing event id' }, { status: 400 });
  }

  // Dedupe de replays por `event_id`: Paddle reenvía el MISMO id en cada
  // reintento, así que un evento ya procesado (no `error`) se descarta. El
  // chequeo es fail-open: si la bitácora falla, se procesa igual.
  try {
    const { data: prior } = await supabaseAdmin
      .from('webhook_events')
      .select('outcome')
      .eq('provider', 'paddle')
      .eq('delivery_id', event.event_id)
      .order('received_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (prior && prior.outcome !== 'error') {
      return NextResponse.json({ received: true });
    }
  } catch (err) {
    logger.warn('webhook_events dedupe no disponible, se procesa igual:', { error: err });
  }

  const result = await processPaddleWebhook(event);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data);
}
