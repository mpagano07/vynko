import { supabaseAdmin } from './supabaseAdmin';
import { logger } from '@/lib/logger';

/**
 * Eventos de producto. La lista tiene que coincidir con el CHECK de
 * `analytics_events.event_type` en migrations/040_product_analytics_funnel.sql.
 * Si se agrega uno aca y no alla, el insert falla con 23514 y el evento se
 * pierde (trackEvent lo loguea, pero no lo evita).
 */
export type AnalyticsEventType =
  | 'signup'
  | 'company_created'
  | 'trial_started'
  | 'payment'
  | 'subscription_started'
  | 'subscription_cancelled'
  | 'product_created'
  | 'excel_import'
  | 'first_sale'
  | 'first_cash_open'
  | 'first_purchase'
  | 'forecast_opened'
  | 'document_created'
  | 'whatsapp_ticket'
  | 'app_return';

/**
 * Los que solo pueden ocurrir una vez por usuario. La unicidad la
 * garantiza el indice parcial `idx_analytics_events_first_unique` de la
 * migracion 040, no esta funcion: el chequeo de aqui es solo para no
 * gastar un round-trip en el caso comun, y el indice sigue siendo lo que
 * resuelve la carrera entre dos requests simultaneos.
 */
const FIRST_EVENT_TYPES: ReadonlySet<AnalyticsEventType> = new Set([
  'first_sale',
  'first_cash_open',
  'first_purchase',
]);

export type TrackEventParams = {
  type: AnalyticsEventType;
  userId: string;
  userEmail?: string | null;
  userName?: string | null;
  tenantId?: string | null;
  metadata?: Record<string, unknown>;
};

/**
 * Graba un evento de producto.
 *
 * Nunca tira. Un evento de analytics es telemetria, no parte del
 * negocio: si la tabla no existe todavia (migracion no aplicada), si el
 * CHECK rechaza el tipo, o si Supabase esta caido, la venta o el
 * producto que el usuario estaba haciendo tienen que igual guardarse. Por
 * eso los errores van al logger y la funcion resuelve.
 */
export async function trackEvent(params: TrackEventParams): Promise<void> {
  const { type, userId } = params;
  if (!userId) return;

  try {
    if (FIRST_EVENT_TYPES.has(type)) {
      const { data: already } = await supabaseAdmin
        .from('analytics_events')
        .select('id')
        .eq('user_id', userId)
        .eq('event_type', type)
        .limit(1)
        .maybeSingle();

      if (already) return;
    }

    const identity = await resolveIdentity(userId, params);

    const { error } = await supabaseAdmin.from('analytics_events').insert({
      event_type: type,
      user_id: userId,
      user_email: identity.email,
      user_name: identity.name,
      tenant_id: params.tenantId ?? null,
      metadata: params.metadata ?? {},
    });

    // 23505 = unique_violation. Dos requests simultaneas dispararon el
    // mismo first_* y gano una. Es el comportamiento que queriamos, no un
    // error, asi que no se loguea.
    if (error && error.code !== '23505') {
      logger.error(`[analytics] no se pudo grabar ${type}:`, { error: error.message });
    }
  } catch (error) {
    logger.error(`[analytics] fallo inesperado en ${type}:`, { error });
  }
}

/**
 * `app_return` se dispara en cada vuelta al producto, asi que sin control
 * genera cientos de filas por usuario y termina tapando el resto de los
 * eventos en la tabla. Se corta a uno por dia por usuario: alcanza para
 * medir retencion y deja la tabla legible.
 */
export async function trackAppReturn(params: {
  userId: string;
  tenantId?: string | null;
  hoursSinceLast?: number;
}): Promise<void> {
  try {
    const { data: last } = await supabaseAdmin
      .from('analytics_events')
      .select('created_at')
      .eq('user_id', params.userId)
      .eq('event_type', 'app_return')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // hoursSinceLast guarda HORAS, que es lo que dice la clave. Antes se
    // guardaba last.created_at, o sea un timestamp, y el panel lo renderizaba
    // como si fueran horas. El timestamp va aparte y con nombre propio.
    const hoursSince = last?.created_at
      ? (Date.now() - new Date(last.created_at).getTime()) / 3_600_000
      : null;

    if (hoursSince !== null && hoursSince < (params.hoursSinceLast ?? 24)) return;

    await trackEvent({
      type: 'app_return',
      userId: params.userId,
      tenantId: params.tenantId,
      metadata: {
        hoursSinceLast: hoursSince === null ? null : Math.round(hoursSince),
        previousVisitAt: last?.created_at ?? null,
      },
    });
  } catch (error) {
    logger.error('[analytics] fallo inesperado en app_return:', { error });
  }
}

async function resolveIdentity(
  userId: string,
  params: TrackEventParams
): Promise<{ email: string | null; name: string | null }> {
  if (params.userEmail !== undefined && params.userName !== undefined) {
    return { email: params.userEmail, name: params.userName };
  }

  const { data } = await supabaseAdmin
    .from('profiles')
    .select('email, full_name')
    .eq('id', userId)
    .maybeSingle();

  return {
    email: params.userEmail ?? data?.email ?? null,
    name: params.userName ?? data?.full_name ?? null,
  };
}
