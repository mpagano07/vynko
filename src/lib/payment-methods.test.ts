import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHECKOUT_SETTINGS,
  normalizeCheckoutSettings,
  PAYMENT_METHODS,
} from './payment-methods';

describe('normalizeCheckoutSettings · disabled_methods', () => {
  it('devuelve la lista vacía cuando no hay configuración', () => {
    expect(normalizeCheckoutSettings(undefined).disabled_methods).toEqual([]);
    expect(normalizeCheckoutSettings(null).disabled_methods).toEqual([]);
    expect(normalizeCheckoutSettings({}).disabled_methods).toEqual([]);
  });

  it('conserva sólo ids de medios conocidos', () => {
    const settings = normalizeCheckoutSettings({
      disabled_methods: ['credit', 'bitcoin', 'mercadopago'],
    });
    expect(settings.disabled_methods).toEqual(['credit', 'mercadopago']);
  });

  it('descarta duplicados', () => {
    const settings = normalizeCheckoutSettings({
      disabled_methods: ['credit', 'credit', 'cash'],
    });
    expect(settings.disabled_methods).toEqual(['credit', 'cash']);
  });

  it('ignora valores que no son strings', () => {
    const settings = normalizeCheckoutSettings({
      disabled_methods: [1, null, { id: 'credit' }, 'debit'],
    });
    expect(settings.disabled_methods).toEqual(['debit']);
  });

  it('cae a la lista vacía si se ocultaron todos los medios', () => {
    const all = PAYMENT_METHODS.map((m) => m.id);
    const settings = normalizeCheckoutSettings({ disabled_methods: all });
    expect(settings.disabled_methods).toEqual([]);
    expect(DEFAULT_CHECKOUT_SETTINGS.disabled_methods).toEqual([]);
  });

  it('no altera el resto de la configuración al normalizar los medios ocultos', () => {
    const settings = normalizeCheckoutSettings({
      payment_adjustments: { cash: -10 },
      disabled_methods: ['credit'],
      paper_size: '80mm',
      show_receipt: false,
    });
    expect(settings.payment_adjustments.cash).toBe(-10);
    expect(settings.paper_size).toBe('80mm');
    expect(settings.show_receipt).toBe(false);
  });
});
