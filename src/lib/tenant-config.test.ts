import { describe, expect, it } from 'vitest';
import { resolveTenantModules, tenantHasModule, SALES_EMAIL } from './tenant-config';

describe('tenant-config', () => {
  it('resuelve módulos de forma segura cuando settings es null/undefined/faltan', () => {
    expect(resolveTenantModules(null).modules).toEqual({});
    expect(resolveTenantModules(undefined).modules).toEqual({});
    expect(resolveTenantModules({}).modules).toEqual({});
  });

  it('extrae el objeto modules del settings del tenant', () => {
    const cfg = resolveTenantModules({ modules: { custom_reporting: true } });
    expect(cfg.modules).toEqual({ custom_reporting: true });
  });

  it('los tenants sin el flag devuelven false (comportamiento por defecto)', () => {
    expect(tenantHasModule({}, 'custom_reporting')).toBe(false);
    expect(tenantHasModule(undefined, 'custom_reporting')).toBe(false);
  });

  it('solo devuelve true si el módulo está activo para ese tenant', () => {
    const cfg = resolveTenantModules({ modules: { custom_reporting: true, other: false } });
    expect(tenantHasModule(cfg.modules, 'custom_reporting')).toBe(true);
    expect(tenantHasModule(cfg.modules, 'other')).toBe(false);
    expect(tenantHasModule(cfg.modules, 'nonexistent')).toBe(false);
  });

  it('expone un email de ventas dedicado para el plan enterprise', () => {
    expect(SALES_EMAIL).toMatch(/^ventas@/);
  });
});
