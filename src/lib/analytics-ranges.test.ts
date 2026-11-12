import { describe, expect, it } from 'vitest';
import {
  ANALYTICS_EVENT_RANGES,
  analyticsSince,
  isAnalyticsRangeDays,
} from './analytics-ranges';

describe('analyticsSince', () => {
  const now = Date.UTC(2026, 10, 12, 12, 0, 0);

  it('calcula el inicio de cada rango en milisegundos exactos', () => {
    expect(analyticsSince(7, now)).toBe('2026-11-05T12:00:00.000Z');
    expect(analyticsSince(30, now)).toBe('2026-10-13T12:00:00.000Z');
    expect(analyticsSince(90, now)).toBe('2026-08-14T12:00:00.000Z');
  });

  it('sin rango no filtra', () => {
    expect(analyticsSince(0, now)).toBeUndefined();
  });
});

describe('isAnalyticsRangeDays', () => {
  it('acepta solo las opciones del selector', () => {
    for (const range of ANALYTICS_EVENT_RANGES) {
      expect(isAnalyticsRangeDays(range.days)).toBe(true);
    }
    expect(isAnalyticsRangeDays(15)).toBe(false);
    expect(isAnalyticsRangeDays(-1)).toBe(false);
  });
});
