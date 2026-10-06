import { supabaseAdmin } from '@/lib/supabaseAdmin';

/**
 * Como termino un evento desde nuestro lado. Debe coincidir con el CHECK de
 * `webhook_events.outcome` (migracion 044).
 */
export type WebhookOutcome = 'processed' | 'duplicate' | 'ignored' | 'error';

type WebhookLogInput = {
  providerEventId: string;
  deliveryId?: string | null;
  topic: string;
  mpStatus?: string | null;
  outcome: WebhookOutcome;
  tenantId?: string | null;
  userId?: string | null;
  error?: string | null;
  durationMs?: number | null;
};

/**
 * Anota un evento recibido en `webhook_events`.
 *
 * Nunca lanza. Una bitacora que puede tumbar el flujo que audita es peor que no
 * tener bitacora: si el insert fallara y eso escalara, el webhook devolveria un
 * 500 por un problema de auditoria y MercadoPago reintentaria un evento que ya
 * se proceso.
 *
 * Los fallos se reportan por consola en vez de ignorarse en silencio: perder la
 * fila es aceptable, no enterarse nunca es lo que hace que una bitacora sea
 * inutil.
 */
export async function recordWebhookEvent(input: WebhookLogInput): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from('webhook_events').insert({
      provider: 'mercadopago',
      provider_event_id: input.providerEventId,
      // Id de ENTREGA (`x-request-id` de MercadoPago), unico por notificacion
      // y distinto del `provider_event_id` (que en suscripciones es el id del
      // preapproval y se reutiliza entre entregas legitimas). Es la clave sobre
      // la que el route deduplica replays (migracion 052).
      delivery_id: input.deliveryId ?? null,
      topic: input.topic,
      mp_status: input.mpStatus ?? null,
      outcome: input.outcome,
      tenant_id: input.tenantId ?? null,
      user_id: input.userId ?? null,
      error: input.error ?? null,
      duration_ms: input.durationMs ?? null,
      processed_at: new Date().toISOString(),
    });

    // PostgREST devuelve el error en el resultado, no lo lanza.
    if (error) {
      console.error('[webhook_events] no se pudo registrar el evento:', error);
    }
  } catch (err) {
    console.error('[webhook_events] fallo inesperado al registrar:', err);
  }
}