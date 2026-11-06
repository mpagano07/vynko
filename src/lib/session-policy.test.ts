import { describe, expect, it } from 'vitest';
import { INACTIVITY_TIMEOUT_MS, isInactivityExpired } from '@/lib/session-policy';

describe('isInactivityExpired', () => {
  const now = 1_800_000_000_000;

  it('no vence dentro del plazo', () => {
    expect(isInactivityExpired(now - INACTIVITY_TIMEOUT_MS, now)).toBe(false);
  });

  it('vence pasada la ventana, incluso por un milisegundo', () => {
    expect(isInactivityExpired(now - INACTIVITY_TIMEOUT_MS - 1, now)).toBe(true);
  });

  it('una cookie ausente o corrupta cuenta como vencida', () => {
    expect(isInactivityExpired(Number.NaN, now)).toBe(true);
    expect(isInactivityExpired(Number.POSITIVE_INFINITY, now)).toBe(true);
  });

  it('acepta el reloj actual por defecto', () => {
    expect(isInactivityExpired(Date.now())).toBe(false);
    expect(isInactivityExpired(Date.now() - INACTIVITY_TIMEOUT_MS - 1)).toBe(true);
  });
});
