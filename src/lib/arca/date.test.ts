import { describe, it, expect } from 'vitest';
import { toArgentinaDate, toArgentinaDateCompact } from './date';

describe('arca date helpers', () => {
  it('usa la zona horaria de Argentina y no UTC', () => {
    // 2026-10-15T01:30:00Z -> en Argentina (UTC-3) todavía es 2026-10-14 22:30.
    const lateNightUtc = new Date('2026-10-15T01:30:00.000Z');
    expect(toArgentinaDate(lateNightUtc)).toBe('2026-10-14');
    expect(toArgentinaDateCompact(lateNightUtc)).toBe('20261014');
  });

  it('formatea en YYYYMMDD para WSFE', () => {
    expect(toArgentinaDateCompact('2026-01-05T12:00:00.000Z')).toBe('20260105');
  });

  it('cae a la fecha actual ante un valor inválido', () => {
    expect(toArgentinaDate('no-es-una-fecha')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
