import { NextResponse } from 'next/server';
import { verifyMercadoPagoSignature } from '@/lib/mercadopago';
import { processMercadoPagoWebhook } from '@/lib/mercadopago-webhook-service';

export async function POST(request: Request) {
  // Clone the request to read the raw text for signature verification
  // while still being able to parse JSON afterwards.
  const cloned = request.clone();
  const rawText = await cloned.text();

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const data = body.data as Record<string, unknown> | undefined;
  const rawId = data?.id ?? body.id;
  const id = typeof rawId === 'string' ? rawId : undefined;
  const isValidSignature = verifyMercadoPagoSignature(request, id);
  if (!isValidSignature) {
    console.error('Invalid MercadoPago webhook signature');
    return NextResponse.json({ error: 'Unauthorized webhook request' }, { status: 401 });
  }

  const topic = body.type || body.topic;

  const result = await processMercadoPagoWebhook(id, topic);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data);
}