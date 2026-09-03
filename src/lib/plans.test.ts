import { describe, expect, it } from 'vitest';
import { PLANS, PLAN_ORDER, PLAN_LIMITS } from './plans';

describe('plans configuration', () => {
  it('has consistent definitions for all plans in PLAN_ORDER', () => {
    PLAN_ORDER.forEach((planId) => {
      // Plan exists in PLANS
      expect(PLANS[planId]).toBeDefined();
      expect(PLANS[planId].id).toBe(planId);
      
      // Plan exists in PLAN_LIMITS
      expect(PLAN_LIMITS[planId]).toBeDefined();
    });
  });

  it('has valid non-negative prices for all active plans', () => {
    PLAN_ORDER.forEach((planId) => {
      const plan = PLANS[planId];
      if (!plan.comingSoon) {
        expect(typeof plan.price).toBe('number');
        expect(plan.price).toBeGreaterThanOrEqual(0);
      }
    });
  });

  it('has valid features array for active plans', () => {
    PLAN_ORDER.forEach((planId) => {
      const plan = PLANS[planId];
      if (!plan.comingSoon) {
        expect(Array.isArray(plan.features)).toBe(true);
        expect(plan.features.length).toBeGreaterThan(0);
        
        plan.features.forEach((feature) => {
          expect(feature.label).toBeDefined();
          expect(typeof feature.label).toBe('string');
          expect(typeof feature.included).toBe('boolean');
        });
      }
    });
  });

  it('has strictly positive limits defined in PLAN_LIMITS', () => {
    PLAN_ORDER.forEach((planId) => {
      const limits = PLAN_LIMITS[planId];
      expect(limits.products).toBeGreaterThan(0);
      expect(limits.users).toBeGreaterThan(0);
      expect(limits.branches).toBeGreaterThan(0);
    });
  });

  it('positions enterprise as a made-to-measure available plan', () => {
    const enterprise = PLANS.enterprise;
    expect(enterprise.comingSoon).toBeFalsy();
    expect(enterprise.price).toBe(0);
    expect(enterprise.features.length).toBeGreaterThan(0);
    const labels = enterprise.features.map(f => f.label);
    expect(labels).toContain('Módulos');
    expect(labels).toContain('Integraciones');
  });
});
