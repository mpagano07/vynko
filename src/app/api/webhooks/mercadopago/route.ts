import { NextResponse } from 'next/server';
import { verifyMercadoPagoSignature } from '@/lib/mercadopago';
import { processMercadoPagoWebhook } from '@/lib/mercadopago-webhook-service';
import { parseWebhookPayload } from '@/lib/mercadopago-webhook-schema';

export async function POST(request: Request) {
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
    console.error('Invalid MercadoPago webhook signature');
    return NextResponse.json({ error: 'Unauthorized webhook request' }, { status: 401 });
  }

  const result = await processMercadoPagoWebhook(id, topic);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data);
}