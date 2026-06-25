const TRIAL_DAYS = 30;

export interface TenantSubscription {
  subscription_status: string | null;
  subscription_plan: string | null;
  created_at: string | null;
  subscription_current_period_end: string | null;
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
          message: 'Tu período de prueba de 30 días finalizó. Seleccioná un plan para seguir usando StockPilot.',
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
