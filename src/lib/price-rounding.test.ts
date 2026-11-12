import { describe, expect, it } from 'vitest';
import {
  PRICE_ROUNDING_OPTIONS,
  isPriceRounding,
  roundPriceCents,
} from './price-rounding';

describe('roundPriceCents', () => {
  it('sin redondeo solo quita decimales de centavos', () => {
    expect(roundPriceCents(148_712, 0)).toBe(148_712);
    expect(roundPriceCents(148_712.6, 0)).toBe(148_713);
  });

  it('redondea a la decena de pesos', () => {
    expect(roundPriceCents(148_712, 10)).toBe(149_000);
    expect(roundPriceCents(148_260, 10)).toBe(148_000);
  });

  it('redondea al centenar de pesos', () => {
    expect(roundPriceCents(148_700, 100)).toBe(150_000);
    expect(roundPriceCents(144_900, 100)).toBe(140_000);
  });

  it('redondea al millar de pesos', () => {
    expect(roundPriceCents(1_487_000, 1000)).toBe(1_500_000);
  });

  it('no deja el precio en cero cuando el producto es más barato que el paso', () => {
    expect(roundPriceCents(500, 1000)).toBe(500);
  });
});

describe('isPriceRounding', () => {
  it('acepta solo las opciones del selector', () => {
    for (const option of PRICE_ROUNDING_OPTIONS) {
      expect(isPriceRounding(option.value)).toBe(true);
    }
    expect(isPriceRounding(25)).toBe(false);
    expect(isPriceRounding('100')).toBe(false);
    expect(isPriceRounding(undefined)).toBe(false);
  });
});
