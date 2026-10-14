import { describe, expect, it } from 'vitest';
import { canUseFacturacion } from './access';

describe('canUseFacturacion', () => {
  it('habilita siempre a la cuenta admin', () => {
    expect(canUseFacturacion({ is_admin: true })).toBe(true);
    expect(canUseFacturacion({ is_admin: true }, { subscription_plan: 'starter' })).toBe(true);
    expect(canUseFacturacion({ is_admin: true }, null)).toBe(true);
  });

  it('mientras la feature está en pruebas, no habilita por plan', () => {
    // No-admin: todavía no se abre a business/enterprise (FACTURACION_LAUNCHED).
    expect(canUseFacturacion({ is_admin: false }, { subscription_plan: 'business' })).toBe(false);
    expect(canUseFacturacion({ is_admin: false }, { subscription_plan: 'enterprise' })).toBe(false);
    expect(canUseFacturacion(null, { subscription_plan: 'enterprise' })).toBe(false);
    expect(canUseFacturacion(undefined)).toBe(false);
  });
});
