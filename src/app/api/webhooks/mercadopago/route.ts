import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { verifyMercadoPagoSignature } from '@/lib/mercadopago';
import { processMercadoPagoWebhook } from '@/lib/mercadopago-webhook-service';
import { parseWebhookPayload } from '@/lib/mercadopago-webhook-schema';
import { logger } from '@/lib/logger';
import { enterLogContext, resolveRequestId } from '@/lib/log-context';

export async function POST(request: Request) {
  // El webhook no pasa por getAuth: el contexto se entra aca para que cada log
  // del procesamiento quede amarrado a la entrega de MercadoPago.
  enterLogContext({ requestId: resolveRequestId(request), job: 'mercadopago-webhook' });
  // Clone the request to read the raw text for signature verification
  // while still being able to parse JSON afterwards.
  const cloned = request.clone();
  const rawText = await cloned.text();

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Validacion de forma. Antes solo se comprobaba que el JSON fuera parseable y
  // se casteaba a `Record<string, unknown>`: eso deja pasar un `data` que es un
  // array, un `type` que es un objeto o un `id` numerico, y esas formas
  // reventan mas adentro, en el servicio, con un error que no dice nada del
  // payload. Ahora el rechazo ocurre aca, con un mensaje util.
  const payload = parseWebhookPayload(parsedJson);
  if (!payload.ok) {
    return NextResponse.json({ error: payload.reason }, { status: 400 });
  }

  const { id, topic } = payload.data;

  const isValidSignature = verifyMercadoPagoSignature(request, id);
  if (!isValidSignature) {
    logger.error('Invalid MercadoPago webhook signature', { deliveryId: request.headers.get('x-request-id') });
    return NextResponse.json({ error: 'Unauthorized webhook request' }, { status: 401 });
  }

  // Dedupe temprano de replays, despues de la firma y ANTES de tocar la API de
  // MercadoPago o de escribir en tenants.
  //
  // `x-request-id` es el id de ENTREGA: unico por notificacion. Un reintento de
  // la misma entrega repite ese id; una renovacion mensual es una notificacion
  // nueva (id distinto) que apunta al mismo preapproval, y tiene que procesarse.
  // Por eso el dedupe es por delivery y no por `data.id` (el preapproval), que
  // se reutiliza entre eventos legitimos (ver migracion 052).
  //
  // El chequeo es fail-open: si la lectura falla se procesa igual, el webhook
  // no puede bloquearse por un problema de su propia bitacora. Y un delivery
  // previo con outcome 'error' NO corta: MercadoPago lo esta reintentando para
  // que se procese, y 200'earlo ahora lo daria por terminado sin activar nada.
  const deliveryId = request.headers.get('x-request-id');
  if (deliveryId) {
    try {
      const { data: prior } = await supabaseAdmin
        .from('webhook_events')
        .select('outcome')
        .eq('provider', 'mercadopago')
        .eq('delivery_id', deliveryId)
        .order('received_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (prior && prior.outcome !== 'error') {
        return NextResponse.json({ received: true });
      }
    } catch (err) {
      logger.warn('webhook_events dedupe no disponible, se procesa igual:', { error: err });
    }
  }

  const result = await processMercadoPagoWebhook(id, topic, deliveryId ?? undefined);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data);
}
