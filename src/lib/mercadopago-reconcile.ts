import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { getPreApprovalById } from '@/lib/mercadopago';
import { processMercadoPagoWebhook } from '@/lib/mercadopago-webhook-service';

/**
 * Cuantos tenants comparar por corrida.
 *
 * MercadoPago tiene limite de requests y ademas cada comparacion es una llamada
 * a su API. Recorrer todos los tenants suscritos en cada pasada es rapido
 * today y un problema en cuanto haya cientos. El limite hace que la corrida sea
 * acotada y, si quedan pendientes, la siguiente pasada continues desde donde
 * quedo en vez de reprocesar los mismos.
 */
const DEFAULT_LIMIT = 100;

export type ReconcileOutcome =
  /** El estado en la base coincidia con MercadoPago: no habia nada que hacer. */
  | 'in_sync'
  /** Se aplico una transicion (el webhook se habia perdido). */
  | 'repaired'
  /** No se pudo decidir (fallo la API de MP): se revisa en la proxima pasada. */
  | 'unreachable';

export type ReconcileReport = {
  checked: number;
  inSync: number;
  repaired: number;
  unreachable: number;
  /** Los que no se pudieron consultar, para que la proxima pasada los reintente. */
  deferred: string[];
  details: Array<{ tenantId: string; preapprovalId: string; outcome: ReconcileOutcome }>;
};

type ReconcileOptions = {
  limit?: number;
  /** Inyectable para tests: no se quiere llamar a MercadoPago en unit tests. */
  fetchPreapproval?: typeof getPreApprovalById;
  /** Inyectable para tests. */
  process?: typeof processMercadoPagoWebhook;
};

/**
 * Que estado de suscripcion corresponde a cada estado de MercadoPago.
 *
 * `pending` NO esta: un preapproval en `pending` con la base en `canceled`
 * significa que el usuario empezo un checkout que nunca completo, no que haya
 * una divergencia que corregir. Reconciliar ese caso reactivaria al tenant sin
 * que nadie haya pagado.
 */
function expectedFromMpStatus(mpStatus: string): 'active' | 'canceled' | 'past_due' | null {
  switch (mpStatus) {
    case 'authorized':
      return 'active';
    case 'cancelled':
      return 'canceled';
    case 'paused':
      return 'past_due';
    default:
      return null;
  }
}

/**
 * Compara el estado de suscripcion en la base contra MercadoPago y repara las
 * divergencias.
 *
 * Por que existe: el webhook es la unica via de sincronizacion, y un webhook
 * se pierde. Si el pago se rechaza y el evento no llega, el tenant sigue con
 * acceso activo y nadie se entera; si la cancelacion se pierde, sigue pagando.
 * Ninguna de las dos se resuelve sola.
 *
 * La reparacion REUTILIZA `processMercadoPagoWebhook` en vez de reimplementar
 * las transiciones. Es lo que hace que esto sea seguro: el camino de
 * reconciliacion y el del webhook ejecutan exactamente el mismo compare-and-set,
 * asi que no hay una segunda version de la regla de negocio que pueda quedar
 * desactualizada respecto de la primera. Si la fila ya esta en el estado que
 * corresponde, el update no matchea y no cambia nada.
 */
export async function reconcileSubscriptions(
  options: ReconcileOptions = {}
): Promise<ReconcileReport> {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const fetchPreapproval = options.fetchPreapproval ?? getPreApprovalById;
  const process = options.process ?? processMercadoPagoWebhook;

  const { data: tenants, error } = await supabaseAdmin
    .from('tenants')
    .select('id, subscription_status, mercadopago_preapproval_id')
    .not('mercadopago_preapproval_id', 'is', null)
    .order('updated_at', { ascending: true })
    .limit(limit);

  if (error) {
    return {
      checked: 0,
      inSync: 0,
      repaired: 0,
      unreachable: 0,
      deferred: [],
      details: [],
    };
  }

  const report: ReconcileReport = {
    checked: 0,
    inSync: 0,
    repaired: 0,
    unreachable: 0,
    deferred: [],
    details: [],
  };

  for (const tenant of tenants ?? []) {
    const preapprovalId = tenant.mercadopago_preapproval_id as string;
    const tenantId = tenant.id as string;

    // `checked` cuenta todo tenant examinado, incluidos los que no se pudieron
    // resolver, para que inSync + repaired + unreachable cuadre con el total.
    report.checked += 1;

    let mpStatus: string;
    try {
      const preapproval = await fetchPreapproval(preapprovalId);
      mpStatus = String(preapproval?.status ?? '');
    } catch {
      // Fallo transitorio de la API de MP: no se toca nada y se reintenta en la
      // proxima pasada. Marcarlo como cancelado por no poder consultar seria
      // el peor resultado posible.
      report.unreachable += 1;
      report.deferred.push(preapprovalId);
      report.details.push({ tenantId, preapprovalId, outcome: 'unreachable' });
      continue;
    }

    const expected = expectedFromMpStatus(mpStatus);

    if (expected === null) {
      // Estado que no sabemos mapear (`pending` incluido): se deja como esta.
      report.details.push({ tenantId, preapprovalId, outcome: 'in_sync' });
      report.inSync += 1;
      continue;
    }

    if (tenant.subscription_status === expected) {
      report.inSync += 1;
      report.details.push({ tenantId, preapprovalId, outcome: 'in_sync' });
      continue;
    }

    // Divergencia: se reaplica el mismo camino que el webhook.
    const result = await process(preapprovalId, 'subscription_preapproval');

    if (result.ok) {
      report.repaired += 1;
      report.details.push({ tenantId, preapprovalId, outcome: 'repaired' });
    } else {
      report.unreachable += 1;
      report.deferred.push(preapprovalId);
      report.details.push({ tenantId, preapprovalId, outcome: 'unreachable' });
    }
  }

  return report;
}