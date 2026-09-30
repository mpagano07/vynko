import { describe, it, expect } from 'vitest';
import { formatDate, formatTime, timeAgo } from './format';

describe('formatTime', () => {
  const fecha = '2026-09-29T14:09:00.000Z';

  it('devuelve solo la hora, no la fecha entera', () => {
    // El motivo de que esta funcion exista: formatDate con opciones de hora
    // devuelve "29/9/2026, 11:09 a. m.", o sea la fecha sumada a la hora.
    const hora = formatTime(fecha);

    expect(hora).not.toContain('2026');
    expect(hora).not.toMatch(/\d{1,2}\/\d{1,2}/);
    expect(hora).toMatch(/\d{1,2}:\d{2}/);
  });

  it('tolera null, undefined y valores invalidos', () => {
    expect(formatTime(null)).toBe('');
    expect(formatTime(undefined)).toBe('');
    expect(formatTime('no es una fecha')).toBe('');
  });
});

describe('formatDate', () => {
  it('respeta las opciones que se le pasan', () => {
    expect(formatDate('2026-09-29T14:09:00.000Z', { day: '2-digit', month: 'short' })).not.toContain('2026');
  });

  it('usa el formato largo por defecto', () => {
    expect(formatDate('2026-09-29T14:09:00.000Z')).toMatch(/2026/);
  });

  it('tolera null y valores invalidos', () => {
    expect(formatDate(null)).toBe('');
    expect(formatDate('no es una fecha')).toBe('');
  });
});

describe('timeAgo', () => {
  it('degrada a unidades legibles', () => {
    const hace = (ms: number) => timeAgo(new Date(Date.now() - ms));
    expect(hace(5_000)).toBe('ahora');
    expect(hace(5 * 60_000)).toBe('hace 5m');
    expect(hace(3 * 3_600_000)).toBe('hace 3h');
    expect(hace(2 * 86_400_000)).toBe('hace 2d');
  });

  it('tolera null y valores invalidos', () => {
    expect(timeAgo(null)).toBe('');
    expect(timeAgo('no es una fecha')).toBe('');
  });
});
