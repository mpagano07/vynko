import { describe, expect, it } from 'vitest';
import { resolveNavAccess } from './sidebar';

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

  describe('rol y multi-sucursal', () => {
    it('oculta por rol no permitido', () => {
      expect(
        resolveNavAccess({ requiredRole: ['owner', 'manager'] }, { plan: 'business', role: 'member' })
      ).toEqual({ visible: false, locked: false });
      expect(
        resolveNavAccess({ requiredRole: ['owner', 'manager'] }, { plan: 'business', role: 'owner' })
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
});
