import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatDate, timeAgo } from './format';

const FIXED_NOW = new Date('2026-01-01T12:00:00');

afterEach(() => {
  vi.useRealTimers();
});

describe('formatDate', () => {
  it('formatea una fecha con el formato largo por defecto', () => {
    expect(formatDate('2026-01-01T12:00:00')).toBe('01 de enero de 2026');
  });

  it('acepta un objeto Date y opciones ad hoc', () => {
    const date = new Date('2026-01-15T12:00:00');
    expect(formatDate(date, { day: '2-digit', month: 'short' })).toBe('15-ene');
  });

  it('acepta un locale como segundo argumento', () => {
    expect(formatDate('2026-01-01T12:00:00', 'es-ES')).toBe('01 de enero de 2026');
  });

  it('soporta dateStyle', () => {
    expect(formatDate('2026-01-01T12:00:00', { dateStyle: 'medium' })).toBe('1 ene 2026');
  });

  it('devuelve string vacío para valores nulos o inválidos', () => {
    expect(formatDate(null)).toBe('');
    expect(formatDate(undefined)).toBe('');
    expect(formatDate('no-es-una-fecha')).toBe('');
  });
});

describe('timeAgo', () => {
  it('evalúa los rangos relativos', () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);

    expect(timeAgo(FIXED_NOW.toISOString())).toBe('ahora');
    expect(timeAgo(new Date(FIXED_NOW.getTime() - 90 * 1000).toISOString())).toBe('hace 1m');
    expect(timeAgo(new Date(FIXED_NOW.getTime() - 2 * 3600 * 1000).toISOString())).toBe('hace 2h');
    expect(timeAgo(new Date(FIXED_NOW.getTime() - 3 * 86400 * 1000).toISOString())).toBe('hace 3d');
  });

  it('devuelve string vacío para valores nulos o inválidos', () => {
    expect(timeAgo(null)).toBe('');
    expect(timeAgo(undefined)).toBe('');
    expect(timeAgo('no-es-una-fecha')).toBe('');
  });
});
