import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { isTrialExpired, checkSubscriptionBlocked, consolidateOwnerSubscription, TenantSubscription } from './checkSubscription';

describe('checkSubscription', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('isTrialExpired', () => {
    it('returns false when tenant is null', () => {
      expect(isTrialExpired(null)).toBe(false);
    });

    it('returns false when status is active', () => {
      expect(isTrialExpired({ subscription_status: 'active' })).toBe(false);
    });

    it('returns true when status is past_due', () => {
      expect(isTrialExpired({ subscription_status: 'past_due' })).toBe(true);
    });

    it('returns false for free starter plan within trial period', () => {
      vi.setSystemTime(new Date('2026-08-11T12:00:00Z'));
      const tenant: TenantSubscription = {
        subscription_status: 'free',
        subscription_plan: 'starter',
        created_at: '2026-08-01T12:00:00Z', // 10 days ago
      };
      expect(isTrialExpired(tenant)).toBe(false);
    });

    it('returns true for free starter plan after trial period', () => {
      vi.setSystemTime(new Date('2026-08-11T12:00:00Z'));
      const tenant: TenantSubscription = {
        subscription_status: 'free',
        subscription_plan: 'starter',
        created_at: '2026-06-01T12:00:00Z', // More than 45 days ago
      };
      expect(isTrialExpired(tenant)).toBe(true);
    });

    it('returns false for free starter plan without created_at', () => {
      const tenant: TenantSubscription = {
        subscription_status: 'free',
        subscription_plan: 'starter',
      };
      expect(isTrialExpired(tenant)).toBe(false);
    });

    it('returns false for statuses outside free/active/past_due (canceled)', () => {
      expect(isTrialExpired({ subscription_status: 'canceled' })).toBe(false);
      expect(isTrialExpired({ subscription_status: 'trialing' })).toBe(false);
    });
  });

  describe('checkSubscriptionBlocked', () => {
    it('returns not blocked when tenant is null', () => {
      expect(checkSubscriptionBlocked(null)).toEqual({ blocked: false });
    });

    it('returns not blocked when status is active', () => {
      expect(checkSubscriptionBlocked({ subscription_status: 'active' })).toEqual({ blocked: false });
    });

    it('returns blocked with payment_past_due when status is past_due', () => {
      expect(checkSubscriptionBlocked({ subscription_status: 'past_due' })).toEqual({
        blocked: true,
        reason: 'payment_past_due',
        message: 'Tu suscripción está vencida por falta de pago. Seleccioná un plan para reactivarla.',
      });
    });

    it('returns not blocked for free starter plan within trial period', () => {
      vi.setSystemTime(new Date('2026-08-11T12:00:00Z'));
      const tenant: TenantSubscription = {
        subscription_status: 'free',
        subscription_plan: 'starter',
        created_at: '2026-08-01T12:00:00Z', // 10 days ago
      };
      expect(checkSubscriptionBlocked(tenant)).toEqual({ blocked: false });
    });

    it('returns blocked with trial_expired for free starter plan after trial period', () => {
      vi.setSystemTime(new Date('2026-08-11T12:00:00Z'));
      const tenant: TenantSubscription = {
        subscription_status: 'free',
        subscription_plan: 'starter',
        created_at: '2026-06-01T12:00:00Z', // More than 45 days ago
      };
      expect(checkSubscriptionBlocked(tenant)).toEqual({
        blocked: true,
        reason: 'trial_expired',
        message: 'Tu período de prueba de 45 días finalizó. Seleccioná un plan para seguir usando Vynko.',
      });
    });

    it('returns blocked with trial_expired for free non-starter plan', () => {
      const tenant: TenantSubscription = {
        subscription_status: 'free',
        subscription_plan: 'business',
      };
      expect(checkSubscriptionBlocked(tenant)).toEqual({
        blocked: true,
        reason: 'trial_expired',
        message: 'Tu suscripción no está activa. Completá el pago para seguir usando Vynko.',
      });
    });

    it('returns blocked with trial_expired for incomplete non-starter plan', () => {
      const tenant: TenantSubscription = {
        subscription_status: 'incomplete',
        subscription_plan: 'business',
      };
      expect(checkSubscriptionBlocked(tenant)).toEqual({
        blocked: true,
        reason: 'trial_expired',
        message: 'Tu suscripción no está activa. Completá el pago para seguir usando Vynko.',
      });
    });

    it('returns blocked with trial_expired for canceled plan after period end', () => {
      vi.setSystemTime(new Date('2026-08-11T12:00:00Z'));
      const tenant: TenantSubscription = {
        subscription_status: 'canceled',
        subscription_current_period_end: '2026-08-01T12:00:00Z', // Past date
      };
      expect(checkSubscriptionBlocked(tenant)).toEqual({
        blocked: true,
        reason: 'trial_expired',
        message: 'Tu suscripción finalizó. Seleccioná un plan para reactivarla.',
      });
    });

    it('returns not blocked for canceled plan before period end', () => {
      vi.setSystemTime(new Date('2026-08-11T12:00:00Z'));
      const tenant: TenantSubscription = {
        subscription_status: 'canceled',
        subscription_current_period_end: '2026-09-01T12:00:00Z', // Future date
      };
      expect(checkSubscriptionBlocked(tenant)).toEqual({ blocked: false });
    });

    it('returns not blocked for free starter plan without created_at', () => {
      const tenant: TenantSubscription = {
        subscription_status: 'free',
        subscription_plan: 'starter',
      };
      expect(checkSubscriptionBlocked(tenant)).toEqual({ blocked: false });
    });
  });

  describe('consolidateOwnerSubscription', () => {
    it('returns null for empty list', () => {
      expect(consolidateOwnerSubscription([])).toBeNull();
      expect(consolidateOwnerSubscription(null)).toBeNull();
    });

    it('picks the best plan/status across branches', () => {
      const result = consolidateOwnerSubscription([
        { subscription_status: 'free', subscription_plan: 'starter', created_at: '2026-06-10T00:00:00Z' },
        { subscription_status: 'active', subscription_plan: 'business', created_at: '2026-07-26T00:00:00Z' },
      ]);
      expect(result).toMatchObject({
        subscription_status: 'active',
        subscription_plan: 'business',
      });
    });

    it('uses the earliest created_at (first/payment date) across all branches', () => {
      const result = consolidateOwnerSubscription([
        { subscription_status: 'active', subscription_plan: 'business', created_at: '2026-07-26T00:00:00Z' },
        { subscription_status: 'free', subscription_plan: 'starter', created_at: '2026-06-10T00:00:00Z' },
      ]);
      expect(result?.created_at).toBe('2026-06-10T00:00:00Z');
    });

    it('a block is evaluated against the consolidated owner subscription', () => {
      const consolidated = consolidateOwnerSubscription([
        { subscription_status: 'free', subscription_plan: 'starter', created_at: '2026-06-01T00:00:00Z' },
        { subscription_status: 'active', subscription_plan: 'business', created_at: '2026-07-26T00:00:00Z' },
      ]);
      vi.setSystemTime(new Date('2026-08-11T12:00:00Z'));
      expect(checkSubscriptionBlocked(consolidated)).toEqual({ blocked: false });
    });
  });
});
