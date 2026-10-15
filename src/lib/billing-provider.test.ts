import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { asBillingProvider, canUsePaddle, resolveBillingProvider } from './billing-provider';

const originalKey = process.env.PADDLE_API_KEY;
const originalPrices = process.env.PADDLE_PRICE_IDS;

function configurePaddle() {
  process.env.PADDLE_API_KEY = 'pdl_sdbx_apikey_x';
  process.env.PADDLE_PRICE_IDS = JSON.stringify({
    COP: { starter: 'pri_cop_starter', business: 'pri_cop_business' },
    MXN: { starter: 'pri_mxn_starter', business: 'pri_mxn_business' },
    USD: { starter: 'pri_usd_starter', business: 'pri_usd_business' },
  });
}

describe('billing-provider', () => {
  beforeEach(() => {
    delete process.env.PADDLE_API_KEY;
    delete process.env.PADDLE_PRICE_IDS;
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.PADDLE_API_KEY;
    else process.env.PADDLE_API_KEY = originalKey;
    if (originalPrices === undefined) delete process.env.PADDLE_PRICE_IDS;
    else process.env.PADDLE_PRICE_IDS = originalPrices;
  });

  describe('canUsePaddle', () => {
    it('es false para Argentina siempre', () => {
      configurePaddle();
      expect(canUsePaddle('AR', 'business')).toBe(false);
    });

    it('es false si Paddle no está configurado', () => {
      expect(canUsePaddle('CO', 'business')).toBe(false);
    });

    it('es false si falta el precio de esa moneda', () => {
      process.env.PADDLE_API_KEY = 'pdl_sdbx_apikey_x';
      process.env.PADDLE_PRICE_IDS = JSON.stringify({ MXN: { business: 'pri_mxn_business' } });
      expect(canUsePaddle('CO', 'business')).toBe(false);
    });

    it('es true para un país con precio configurado', () => {
      configurePaddle();
      expect(canUsePaddle('CO', 'business')).toBe(true);
      expect(canUsePaddle('MX', 'starter')).toBe(true);
    });

    it('es false para enterprise (no se cobra por Paddle)', () => {
      configurePaddle();
      expect(canUsePaddle('CO', 'enterprise')).toBe(false);
    });
  });

  describe('resolveBillingProvider', () => {
    it('respeta el proveedor existente de la cuenta', () => {
      configurePaddle();
      expect(resolveBillingProvider('CO', 'business', 'mercadopago')).toBe('mercadopago');
      expect(resolveBillingProvider('AR', 'business', 'paddle')).toBe('paddle');
    });

    it('elige Paddle para un país elegible sin pagos previos', () => {
      configurePaddle();
      expect(resolveBillingProvider('CO', 'business', null)).toBe('paddle');
    });

    it('elige MercadoPago para Argentina sin pagos previos', () => {
      configurePaddle();
      expect(resolveBillingProvider('AR', 'business', null)).toBe('mercadopago');
    });

    it('cae a MercadoPago si el país no tiene precio de Paddle', () => {
      process.env.PADDLE_API_KEY = 'pdl_sdbx_apikey_x';
      process.env.PADDLE_PRICE_IDS = JSON.stringify({ MXN: { business: 'pri_mxn_business' } });
      expect(resolveBillingProvider('CO', 'business', null)).toBe('mercadopago');
    });
  });

  describe('asBillingProvider', () => {
    it('normaliza valores válidos y descarta el resto', () => {
      expect(asBillingProvider('paddle')).toBe('paddle');
      expect(asBillingProvider('mercadopago')).toBe('mercadopago');
      expect(asBillingProvider('stripe')).toBeNull();
      expect(asBillingProvider(null)).toBeNull();
      expect(asBillingProvider(undefined)).toBeNull();
    });
  });
});
