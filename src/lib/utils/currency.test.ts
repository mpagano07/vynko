import { describe, expect, it } from 'vitest';
import { formatARS } from './currency';

const normalize = (s: string) => s.replace(/\u00A0/g, ' ');

describe('formatARS', () => {
  it('formats an integer value with two decimals', () => {
    expect(normalize(formatARS(1500))).toBe('$ 1.500,00');
  });

  it('formats a decimal value', () => {
    expect(normalize(formatARS(1234.5))).toBe('$ 1.234,50');
  });

  it('formats zero', () => {
    expect(normalize(formatARS(0))).toBe('$ 0,00');
  });

  it('handles negative values', () => {
    expect(normalize(formatARS(-99.9))).toBe('-$ 99,90');
  });
});
