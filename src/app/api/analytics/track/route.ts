import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { trackEvent, trackAppReturn, type AnalyticsEventType } from '@/lib/track-event';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

/**
 * Eventos que solo se pueden originar en el navegador: el de compartir por
 * WhatsApp (es un window.open, no hay servidor en el medio) y el de vuelta al
 * producto (que se dispara al montar la app, no en una accion).
 *
 * Deliberadamente NO se acepta un event_type libre desde el body: la lista
 * esta escrita aca. Si aceptara cualquiera, cualquiera autenticado podria
 * fabricar eventos de su embudo y de otros tenants con un `curl`, y las
 * metricas dejan de significar algo.
 */
const ALLOWED: ReadonlySet<AnalyticsEventType> = new Set(['whatsapp_ticket', 'app_return']);

export async function POST(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const limit = await rateLimit(`analytics:track:${getClientIp(request)}`, 60, 60 * 1000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Demasiadas consultas' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    );
  }

  let body: { type?: unknown; metadata?: unknown };
  try {
    body = (await request.json()) as { type?: unknown; metadata?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const type = body.type;
  if (typeof type !== 'string' || !ALLOWED.has(type as AnalyticsEventType)) {
    return NextResponse.json({ error: 'Unsupported event type' }, { status: 400 });
  }

  const metadata = sanitizeMetadata(body.metadata);

  if (type === 'app_return') {
    // UnDia por usuario: trackAppReturn ya corta si el ultimo fue hace poco.
    await trackAppReturn({ userId: auth.userId, tenantId: auth.tenantId });
  } else {
    // Mide el clic en el boton, NO que el mensaje se haya entregado. La
    // aplicacion abre WhatsApp con window.open y no hay forma de saber si
    // el usuario completo el chat. Por eso el nombre del evento es
    // whatsapp_ticket y no whatsapp_sent: si alguna vez se cambia a la API
    // de WhatsApp y se puede confirmar la entrega, el evento se separa en
    // dos y queda claro cual es cual.
    await trackEvent({
      type: 'whatsapp_ticket',
      userId: auth.userId,
      tenantId: auth.tenantId,
      metadata,
    });
  }

  return NextResponse.json({ ok: true });
}

/**
 * El metadata viene del navegador, asi que se recorta y se filtra antes de
 * guardarlo: sin esto, un tenant podria meter arbitrariamente en
 * analytics_events.metadata -- que el panel de admin lee crudo -- y dejar
 * datos de otros productos o payloads grandes.
 */
function sanitizeMetadata(raw: unknown): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>).slice(0, 10)) {
    if (typeof value === 'string') {
      out[key] = value.slice(0, 200);
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = value;
    } else if (typeof value === 'boolean') {
      out[key] = value;
    }
  }
  return out;
}
