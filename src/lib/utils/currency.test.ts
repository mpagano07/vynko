import { describe, expect, it } from 'vitest';
import { formatARS, groupThousands, parseAmountInput, amountToInput } from './currency';

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

describe('groupThousands', () => {
  it('agrupa los miles mientras se tipea', () => {
    expect(groupThousands('80000')).toBe('80.000');
    expect(groupThousands('1234567')).toBe('1.234.567');
  });

  it('respeta los decimales con coma', () => {
    expect(groupThousands('80000,5')).toBe('80.000,5');
    expect(groupThousands('1234,56')).toBe('1.234,56');
  });

  it('descarta letras y corta en el primer separador decimal', () => {
    expect(groupThousands('8a0.0b0c0')).toBe('80.000');
    expect(groupThousands('1,2,3')).toBe('1,2');
  });

  it('devuelve vacío cuando no hay dígitos', () => {
    expect(groupThousands('')).toBe('');
  });
});

describe('parseAmountInput', () => {
  it('deshace los separadores de miles', () => {
    expect(parseAmountInput('80.000')).toBe(80000);
    expect(parseAmountInput('1.234.567')).toBe(1234567);
  });

  it('lee decimales con coma', () => {
    expect(parseAmountInput('80.000,50')).toBe(80000.5);
  });

  it('devuelve 0 para vacío o no parseable', () => {
    expect(parseAmountInput('')).toBe(0);
    expect(parseAmountInput('abc')).toBe(0);
  });

  it('round-trip con groupThousands', () => {
    expect(parseAmountInput(groupThousands('80000'))).toBe(80000);
    expect(parseAmountInput(groupThousands('1234,56'))).toBe(1234.56);
  });
});

describe('amountToInput', () => {
  it('arma el texto inicial del input desde el numero guardado', () => {
    expect(amountToInput(80000)).toBe('80.000');
    expect(amountToInput(1234.56)).toBe('1.234,56');
  });

  it('deja vacío el cero para no mostrar un 0 engañoso', () => {
    expect(amountToInput(0)).toBe('');
  });
});
