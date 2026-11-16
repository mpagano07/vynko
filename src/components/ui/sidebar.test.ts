import { describe, expect, it } from 'vitest';
import { resolveNavAccess, resolveSidebarPlan } from './sidebar';

// Item con la config real de Facturación ARCA: sólo se muestra a quien tenga la
// feature habilitada (hoy, la cuenta admin; al lanzarla, business/enterprise).
const facturacion = { requiresFacturacion: true };

describe('resolveNavAccess', () => {
  describe('feature de facturación', () => {
    it('oculta la facturación a quien no la tiene habilitada', () => {
      expect(resolveNavAccess(facturacion, { plan: 'business', facturacion: false })).toEqual({
        visible: false,
        locked: false,
      });
      expect(resolveNavAccess(facturacion, { plan: 'enterprise', facturacion: false })).toEqual({
        visible: false,
        locked: false,
      });
      expect(resolveNavAccess(facturacion, { plan: 'starter', isAdmin: false })).toEqual({
        visible: false,
        locked: false,
      });
    });

    it('la muestra cuando la cuenta la tiene habilitada', () => {
      expect(resolveNavAccess(facturacion, { plan: 'starter', facturacion: true })).toEqual({
        visible: true,
        locked: false,
      });
    });

    it('la oculta fuera de Argentina aunque la cuenta la tenga habilitada', () => {
      expect(
        resolveNavAccess(facturacion, { plan: 'business', facturacion: true, country: 'CO' })
      ).toEqual({ visible: false, locked: false });
      expect(
        resolveNavAccess(facturacion, { plan: 'business', facturacion: true, country: 'MX' })
      ).toEqual({ visible: false, locked: false });
    });

    it('la muestra en Argentina cuando la cuenta la tiene habilitada', () => {
      expect(
        resolveNavAccess(facturacion, { plan: 'business', facturacion: true, country: 'AR' })
      ).toEqual({ visible: true, locked: false });
    });
  });

  describe('items gated por plan', () => {
    const soloPlan = { requiredPlan: ['business', 'enterprise'] };

    it('se ve bloqueado en starter', () => {
      expect(resolveNavAccess(soloPlan, { plan: 'starter' })).toEqual({
        visible: true,
        locked: true,
      });
    });

    it('se ve habilitado en business y enterprise', () => {
      expect(resolveNavAccess(soloPlan, { plan: 'business' })).toEqual({
        visible: true,
        locked: false,
      });
      expect(resolveNavAccess(soloPlan, { plan: 'enterprise' })).toEqual({
        visible: true,
        locked: false,
      });
    });
  });

  describe('capacidad y multi-sucursal', () => {
    it('oculta cuando el rol no tiene la capacidad', () => {
      expect(
        resolveNavAccess({ requiredCapability: 'view_reports' }, { plan: 'business', role: 'member' })
      ).toEqual({ visible: false, locked: false });
      expect(
        resolveNavAccess({ requiredCapability: 'view_reports' }, { plan: 'business', role: 'viewer' })
      ).toEqual({ visible: true, locked: false });
      expect(
        resolveNavAccess({ requiredCapability: 'view_reports' }, { plan: 'business', role: 'owner' })
      ).toEqual({ visible: true, locked: false });
    });

    it('oculta sin multi-sucursal', () => {
      expect(resolveNavAccess({ requiredMultiBranch: true }, { plan: 'business' })).toEqual({
        visible: false,
        locked: false,
      });
      expect(
        resolveNavAccess({ requiredMultiBranch: true }, { plan: 'business', multiBranch: true })
      ).toEqual({ visible: true, locked: false });
    });
  });

  describe('secciones que requieren una sucursal', () => {
    const ventas = { requiredSingleBranch: true };

    it('se ven con candado de sucursal en "Todas las sucursales"', () => {
      expect(resolveNavAccess(ventas, { plan: 'business', allTenants: true })).toEqual({
        visible: true,
        locked: true,
        lockedReason: 'branch',
      });
    });

    it('quedan habilitadas con una sucursal activa', () => {
      expect(resolveNavAccess(ventas, { plan: 'business', allTenants: false })).toEqual({
        visible: true,
        locked: false,
      });
    });
  });
});

describe('resolveSidebarPlan', () => {
  it('usa el plan de las sucursales cuando no hay tenant activo', () => {
    expect(resolveSidebarPlan(null, [{ subscription_plan: 'business' }])).toBe('business');
  });

  it('toma el plan más alto de la empresa', () => {
    expect(
      resolveSidebarPlan(undefined, [
        { subscription_plan: 'starter' },
        { subscription_plan: 'enterprise' },
      ])
    ).toBe('enterprise');
  });

  it('normaliza free/sin plan a starter', () => {
    expect(resolveSidebarPlan(null, [])).toBe('starter');
    expect(resolveSidebarPlan('free', [{ subscription_plan: 'free' }])).toBe('starter');
  });
});
