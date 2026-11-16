import { describe, expect, it } from 'vitest';
import { requiresSingleBranch } from './single-branch-routes';

describe('requiresSingleBranch', () => {
  it('cubre las rutas que operan sobre una sucursal', () => {
    expect(requiresSingleBranch('/sales')).toBe(true);
    expect(requiresSingleBranch('/sales/cash-register')).toBe(true);
    expect(requiresSingleBranch('/documents')).toBe(true);
    expect(requiresSingleBranch('/invoices')).toBe(true);
    expect(requiresSingleBranch('/forecast')).toBe(true);
    expect(requiresSingleBranch('/loss-prevention')).toBe(true);
    expect(requiresSingleBranch('/qr-codes')).toBe(true);
    expect(requiresSingleBranch('/scanning')).toBe(true);
  });

  it('no bloquea las secciones que sí soportan el consolidado', () => {
    expect(requiresSingleBranch('/dashboard')).toBe(false);
    expect(requiresSingleBranch('/activity-logs')).toBe(false);
    expect(requiresSingleBranch('/products')).toBe(false);
  });

  it('compara por segmento, no por prefijo de texto', () => {
    expect(requiresSingleBranch('/salesx')).toBe(false);
    expect(requiresSingleBranch('/forecast-extra')).toBe(false);
  });
});
