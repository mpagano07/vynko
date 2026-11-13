import { describe, expect, it } from 'vitest';
import { marginPercent, parseMarginInput, priceFromMargin } from './product-margin';

describe('marginPercent', () => {
  it('calcula el margen sobre el costo', () => {
    expect(marginPercent(140, 100)).toBeCloseTo(40);
    expect(marginPercent(100, 100)).toBe(0);
  });

  it('devuelve margen negativo cuando se vende bajo costo', () => {
    expect(marginPercent(80, 100)).toBeCloseTo(-20);
  });

  it('devuelve 0 si el costo no es positivo o hay valores inválidos', () => {
    expect(marginPercent(100, 0)).toBe(0);
    expect(marginPercent(100, -5)).toBe(0);
    expect(marginPercent(Number.NaN, 100)).toBe(0);
    expect(marginPercent(100, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('priceFromMargin', () => {
  it('aplica el margen sobre el costo y redondea al peso', () => {
    expect(priceFromMargin(100, 40)).toBe(140);
    expect(priceFromMargin(333, 15)).toBe(383);
  });

  it('acepta margen negativo', () => {
    expect(priceFromMargin(100, -25)).toBe(75);
  });
});

describe('parseMarginInput', () => {
  it('acepta coma decimal, signo y símbolo de porcentaje', () => {
    expect(parseMarginInput('+40,5%')).toBe(40.5);
    expect(parseMarginInput(' 30 ')).toBe(30);
    expect(parseMarginInput('-10')).toBe(-10);
  });

  it('devuelve null cuando no hay número', () => {
    expect(parseMarginInput('')).toBeNull();
    expect(parseMarginInput('%')).toBeNull();
    expect(parseMarginInput('abc')).toBeNull();
  });

  it('no acepta basura después del número', () => {
    expect(parseMarginInput('40abc')).toBeNull();
  });
});
