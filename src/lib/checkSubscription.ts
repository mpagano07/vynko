const TRIAL_DAYS = 45;

export function isTrialExpired(tenant: TenantSubscription | null): boolean {
  if (!tenant) return false;
  const status = tenant.subscription_status || 'free';
  if (status === 'active') return false;

  if (status === 'free' || status === 'incomplete') {
    const plan = tenant.subscription_plan || 'starter';
    if (plan !== 'starter') return true;

    if (tenant.created_at) {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const created = new Date(tenant.created_at);
      const createdDay = new Date(created.getFullYear(), created.getMonth(), created.getDate());
      const daysElapsed = Math.floor((todayStart.getTime() - createdDay.getTime()) / (1000 * 60 * 60 * 24));
      return daysElapsed >= TRIAL_DAYS;
    }
    return false;
  }

  if (status === 'past_due') return true;

  return false;
}

export interface TenantSubscription {
  subscription_status?: string | null;
  subscription_plan?: string | null;
  created_at?: string | null;
  subscription_current_period_end?: string | null;
}

const PLAN_RANK: Record<string, number> = { enterprise: 4, business: 3, starter: 2, free: 1 };
const STATUS_RANK: Record<string, number> = { active: 5, incomplete: 4, past_due: 3, canceled: 2, free: 1 };

/**
 * Consolidates the subscription of an owner across all of their branches
 * (tenants). Every branch of the same owner shares a single subscription:
 * the best plan/status wins and the earliest created_at (the first/payment
 * date) is used as the reference date for the trial or renewal.
 */
export function consolidateOwnerSubscription(
  tenants: TenantSubscription[] | null | undefined
): TenantSubscription | null {
  if (!tenants || tenants.length === 0) return null;

  let best = tenants[0];
  for (const t of tenants) {
    const cur =
      (STATUS_RANK[t.subscription_status || 'free'] || 0) + (PLAN_RANK[t.subscription_plan || 'free'] || 0);
    const anchor =
      (STATUS_RANK[best.subscription_status || 'free'] || 0) + (PLAN_RANK[best.subscription_plan || 'free'] || 0);
    if (cur > anchor) best = t;
  }

  let earliestCreatedAt: string | null = null;
  for (const t of tenants) {
    if (t.created_at && (!earliestCreatedAt || new Date(t.created_at) < new Date(earliestCreatedAt))) {
      earliestCreatedAt = t.created_at;
    }
  }

  return {
    subscription_status: best.subscription_status || 'free',
    subscription_plan: best.subscription_plan || 'free',
    subscription_current_period_end: best.subscription_current_period_end || null,
    created_at: earliestCreatedAt || best.created_at || null,
  };
}

export interface BlockedResult {
  blocked: true;
  reason: 'trial_expired' | 'payment_past_due';
  message: string;
}

export interface NotBlockedResult {
  blocked: false;
}

export type CheckResult = BlockedResult | NotBlockedResult;

export function checkSubscriptionBlocked(tenant: TenantSubscription | null): CheckResult {
  if (!tenant) return { blocked: false };

  const status = tenant.subscription_status || 'free';

  if (status === 'active') return { blocked: false };

  if (status === 'past_due') {
    return {
      blocked: true,
      reason: 'payment_past_due',
      message: 'Tu suscripción está vencida por falta de pago. Seleccioná un plan para reactivarla.',
    };
  }

  if (status === 'free' || status === 'incomplete') {
    const plan = tenant.subscription_plan || 'starter';

    if (plan !== 'starter') {
      return {
        blocked: true,
        reason: 'trial_expired',
        message: 'Tu suscripción no está activa. Completá el pago para seguir usando Vynko.',
      };
    }

    if (tenant.created_at) {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const created = new Date(tenant.created_at);
      const createdDay = new Date(created.getFullYear(), created.getMonth(), created.getDate());
      const daysElapsed = Math.floor((todayStart.getTime() - createdDay.getTime()) / (1000 * 60 * 60 * 24));

      if (daysElapsed >= TRIAL_DAYS) {
        return {
          blocked: true,
          reason: 'trial_expired',
          message: 'Tu período de prueba de 45 días finalizó. Seleccioná un plan para seguir usando Vynko.',
        };
      }
    }
    return { blocked: false };
  }

  if (status === 'canceled' && tenant.subscription_current_period_end) {
    const periodEnd = new Date(tenant.subscription_current_period_end);
    if (periodEnd < new Date()) {
      return {
        blocked: true,
        reason: 'trial_expired',
        message: 'Tu suscripción finalizó. Seleccioná un plan para reactivarla.',
      };
    }
  }

  return { blocked: false };
}
