import { describe, expect, it } from 'vitest';
import { fixResponse } from './encoding';

describe('fixResponse', () => {
  it('fixes the reported Almac├®n case (® = U+00AE)', () => {
    expect(fixResponse('Almac\u251c\u00AEn')).toBe('Almacén');
  });

  it('fixes the CP437 ⌐ variant', () => {
    expect(fixResponse('Almac\u251c\u2310n')).toBe('Almacén');
  });

  it('fixes Latin-1 double-encoded mojibake (AlmacÃ©n)', () => {
    expect(fixResponse('Almac\u00c3\u00a9n')).toBe('Almacén');
  });

  it('leaves already-correct strings unchanged', () => {
    expect(fixResponse('Almacén')).toBe('Almacén');
    expect(fixResponse('Bebida y Líquidos')).toBe('Bebida y Líquidos');
  });

  it('handles a full categories array without breaking', () => {
    const cats = [
      { id: '1', name: 'Almac\u251c\u00AEn', tenant_id: 't1', color: '#3b82f6', created_at: '2026-01-01T00:00:00Z' },
      { id: '2', name: 'Bebidas', tenant_id: 't1', color: null },
    ];
    const out = fixResponse(cats) as Array<Record<string, unknown>>;
    expect(out.length).toBe(2);
    expect(out[0].name).toBe('Almacén');
    expect(out[1].name).toBe('Bebidas');
  });

  it('is defensive: returns original on weird input instead of throwing', () => {
    const weirds = [
      undefined,
      null,
      42,
      true,
      Symbol('x'),
      () => {},
      new Date(0),
      'plain',
    ];
    for (const w of weirds) {
      expect(() => fixResponse(w)).not.toThrow();
    }
  });

  it('does not break on circular references', () => {
    const a: Record<string, unknown> = { name: 'x' };
    a.self = a;
    const result = fixResponse(a) as Record<string, unknown>;
    expect(result.name).toBe('x');
  });

  it('does not corrupt legit ® in strings', () => {
    expect(fixResponse('Café® Premium')).toContain('®');
  });
});
