import { supabaseAdmin } from '@/lib/supabaseAdmin';
import type { AnalyticsEventType } from '@/lib/track-event';

/**
 * Orden del embudo. Solo entran los eventos que son PUERTAS: para llegar al
 * paso N hace falta haber pasado el N-1.
 *
 * Los demas eventos que se instrumentan (excel_import, forecast_opened,
 * document_created, whatsapp_ticket, first_cash_open, first_purchase) no
 * estan aca a proposito. Son acciones optativas, no puertas: no todo el que
 * vende abre caja, no todo el que vende comparte por WhatsApp. Encadenarlos
 * daria una progresion descendente falsa, porque el paso 11 seria menor que
 * el 12 y el embudo dejaria de leerse como embudo. Esos se muestran aparte,
 * como eventos sueltos.
 */
const FUNNEL_STEPS: ReadonlyArray<{ step: number; eventType: AnalyticsEventType; label: string }> = [
  { step: 1, eventType: 'signup', label: 'Se registró' },
  { step: 2, eventType: 'company_created', label: 'Creó su empresa' },
  { step: 3, eventType: 'product_created', label: 'Cargó productos' },
  { step: 4, eventType: 'first_sale', label: 'Hizo su primera venta' },
  { step: 5, eventType: 'app_return', label: 'Volvió' },
  { step: 6, eventType: 'subscription_started', label: 'Empezó a pagar' },
];

export interface FunnelStep {
  step: number;
  eventType: AnalyticsEventType;
  label: string;
  users: number;
  /** Porcentaje sobre el primer paso. El primero siempre da 100. */
  ofTotal: number;
  /** Porcentaje sobre el paso anterior: donde se cae la gente. */
  ofPrevious: number;
  /** Cuántos se perdieron respecto del paso anterior (0 en el primero). */
  dropped: number;
}

export interface EventBreakdown {
  eventType: AnalyticsEventType;
  users: number;
  total: number;
  firstAt: string | null;
  lastAt: string | null;
}

export interface AdminAnalytics {
  funnel: FunnelStep[];
  breakdown: EventBreakdown[];
  signupsByMonth: { month: string; count: number }[];
  activatedByMonth: { month: string; count: number }[];
  subscribedByMonth: { month: string; count: number }[];
  recentEvents: {
    id: string;
    event_type: string;
    user_email: string | null;
    user_name: string | null;
    tenant_id: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
  }[];
}

export type AdminAnalyticsResult =
  | { ok: true; data: AdminAnalytics }
  | { ok: false; error: string; missingView: string };

export async function getAdminAnalytics(): Promise<AdminAnalyticsResult> {
  const [funnelResult, totalsResult, recentResult, monthlyResult] = await Promise.all([
    supabaseAdmin.from('analytics_funnel').select('step, event_type, users, ordered_users'),
    supabaseAdmin.from('analytics_event_totals').select('event_type, users, total, first_at, last_at'),
    supabaseAdmin
      .from('analytics_events')
      .select('id, event_type, user_email, user_name, tenant_id, metadata, created_at')
      .order('created_at', { ascending: false })
      .limit(50),
    supabaseAdmin.from('analytics_events_by_month').select('month, event_type, event_count'),
  ]);

  for (const [name, result] of [
    ['analytics_funnel', funnelResult],
    ['analytics_event_totals', totalsResult],
  ] as const) {
    if (result.error) {
      // La vista no existe si la migracion 040 todavia no se aplico. Se
      // devuelve un error en vez de un embudo en ceros: un panel que dice
      // "0 registros" cuando en realidad no se puede leer la tabla es peor
      // que un panel que dice que falta aplicar la migracion.
      console.error(`[analytics] no se pudo leer ${name}:`, result.error.message);
      return {
        ok: false,
        error: `Falta aplicar la migracion 040 (${name} no existe)`,
        missingView: name,
      };
    }
  }

  const funnel = buildFunnel(funnelResult.data ?? []);
  const breakdown = normalizeBreakdown(totalsResult.data ?? []);

  return {
    ok: true,
    data: {
      funnel,
      breakdown,
      ...buildMonthlySeries(monthlyResult.data ?? []),
      recentEvents: recentResult.data ?? [],
    },
  };
}

function buildFunnel(
  rows: { step: number; event_type: string; users: number; ordered_users: number }[]
): FunnelStep[] {
  const byStep = new Map<number, { users: number; ordered: number }>();
  for (const row of rows) {
    byStep.set(row.step, {
      users: Number(row.users) || 0,
      ordered: Number(row.ordered_users) || 0,
    });
  }

  const counts = FUNNEL_STEPS.map((s) => byStep.get(s.step)?.ordered ?? 0);
  const top = counts[0] ?? 0;

  return FUNNEL_STEPS.map((s, i) => {
    const users = counts[i];
    const previous = i === 0 ? 0 : counts[i - 1];
    return {
      step: s.step,
      eventType: s.eventType,
      label: s.label,
      users,
      // Se usa `ordered`, no `users`: `users` cuenta a cualquiera que hizo
      // el evento aunque lo haya hecho antes que un paso anterior (por
      // ejemplo, cargar productos antes de crear la empresa, que puede
      // pasar si el alta se reintenta). Encadenado asi, el numero de un
      // paso nunca supera al anterior.
      ofTotal: top > 0 ? Math.round((users / top) * 100) : 0,
      ofPrevious: previous > 0 ? Math.round((users / previous) * 100) : 0,
      dropped: Math.max(0, previous - users),
    };
  });
}

function normalizeBreakdown(
  rows: { event_type: string; users: number; total: number; first_at: string | null; last_at: string | null }[]
): EventBreakdown[] {
  const merged = new Map<string, EventBreakdown>();

  for (const row of rows) {
    // 'payment' es el nombre viejo de 'subscription_started': asi se
    // grababa antes de la migracion 040. Las filas historicas con 'payment'
    // se cuelgan del evento nuevo para que el panel no las pierda.
    const eventType = row.event_type === 'payment' ? 'subscription_started' : row.event_type;

    const existing = merged.get(eventType);
    const users = Number(row.users) || 0;
    const total = Number(row.total) || 0;

    if (existing) {
      // Un usuario puede tener ambos eventos si se renewing y el webhook
      // volto a disparar. Para el desglose importa la persona, asi que se
      // suman las filas: entre las dos no se repiten usuarios.
      existing.users += users;
      existing.total += total;
      if (row.first_at && (!existing.firstAt || row.first_at < existing.firstAt)) {
        existing.firstAt = row.first_at;
      }
      if (row.last_at && (!existing.lastAt || row.last_at > existing.lastAt)) {
        existing.lastAt = row.last_at;
      }
    } else {
      merged.set(eventType, {
        eventType: eventType as AnalyticsEventType,
        users,
        total,
        firstAt: row.first_at,
        lastAt: row.last_at,
      });
    }
  }

  return [...merged.values()].sort((a, b) => b.users - a.users);
}

function buildMonthlySeries(
  rows: { month: string; event_type: string; event_count: number }[]
): Pick<AdminAnalytics, 'signupsByMonth' | 'activatedByMonth' | 'subscribedByMonth'> {
  const now = new Date();
  const labels: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    labels.push(d.toLocaleDateString('es-AR', { month: 'short', year: '2-digit' }));
  }

  const byMonth = new Map<string, { signup: number; sale: number; subscribed: number }>();
  for (const row of rows) {
    const d = new Date(String(row.month) + 'T12:00:00');
    const label = d.toLocaleDateString('es-AR', { month: 'short', year: '2-digit' });
    const bucket = byMonth.get(label) ?? { signup: 0, sale: 0, subscribed: 0 };
    const count = Number(row.event_count) || 0;

    if (row.event_type === 'signup') bucket.signup += count;
    else if (row.event_type === 'first_sale') bucket.sale += count;
    else if (row.event_type === 'subscription_started' || row.event_type === 'payment') {
      bucket.subscribed += count;
    }

    byMonth.set(label, bucket);
  }

  return {
    signupsByMonth: labels.map((month) => ({ month, count: byMonth.get(month)?.signup ?? 0 })),
    activatedByMonth: labels.map((month) => ({ month, count: byMonth.get(month)?.sale ?? 0 })),
    subscribedByMonth: labels.map((month) => ({ month, count: byMonth.get(month)?.subscribed ?? 0 })),
  };
}
