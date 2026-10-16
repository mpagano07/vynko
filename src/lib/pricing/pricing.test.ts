import { describe, expect, it } from 'vitest';
import { getCountryFromHeaders } from './country';
import { formatPriceByCountry, getCurrencyForCountry } from './format';
import { PRICES_BY_COUNTRY, getDisplayPrice, getPriceForCountry } from './prices-by-country';

describe('pricing', () => {
  describe('getCountryFromHeaders', () => {
    it('prioriza el header del proxy', () => {
      const h = new Headers({
        'x-vynko-country': 'CO',
        'x-vercel-ip-country': 'MX',
      });
      expect(getCountryFromHeaders(h)).toBe('CO');
    });

    it('usa los headers de país de la plataforma', () => {
      expect(getCountryFromHeaders(new Headers({ 'x-vercel-ip-country': 'co' }))).toBe('CO');
      expect(getCountryFromHeaders(new Headers({ 'cf-ipcountry': 'MX' }))).toBe('MX');
    });

    it('cae a DEFAULT para un país sin precio propio', () => {
      expect(getCountryFromHeaders(new Headers({ 'x-vercel-ip-country': 'DE' }))).toBe('DEFAULT');
    });

    it('usa la cookie vynko_country cuando no hay headers de IP', () => {
      // En /api (el proxy no corre) no existe `x-vynko-country`; sin IP (local)
      // la cookie es el único rastro del país que resolvió el proxy.
      const h = new Headers({ cookie: 'other=1; vynko_country=CO; otro=2' });
      expect(getCountryFromHeaders(h)).toBe('CO');
    });

    it('la IP gana sobre la cookie (no se puede spoofear el cobro)', () => {
      const h = new Headers({
        'x-vercel-ip-country': 'MX',
        cookie: 'vynko_country=CO',
      });
      expect(getCountryFromHeaders(h)).toBe('MX');
    });

    it('default AR sin headers ni cookie', () => {
      expect(getCountryFromHeaders(new Headers())).toBe('AR');
    });
  });

  describe('getCurrencyForCountry', () => {
    it('mapea países a su moneda', () => {
      expect(getCurrencyForCountry('CO')).toBe('COP');
      expect(getCurrencyForCountry('MX')).toBe('MXN');
      expect(getCurrencyForCountry('BR')).toBe('BRL');
      expect(getCurrencyForCountry('EC')).toBe('USD');
      expect(getCurrencyForCountry('DEFAULT')).toBe('USD');
    });

    it('cae a USD para monedas que Paddle no soporta', () => {
      expect(getCurrencyForCountry('BO')).toBe('USD'); // BOB no soportada
      expect(getCurrencyForCountry('GT')).toBe('USD'); // GTQ no soportada
      expect(getCurrencyForCountry('PY')).toBe('USD'); // PYG no soportada
      expect(getCurrencyForCountry('UY')).toBe('USD'); // UYU no soportada
    });
  });

  describe('getPriceForCountry', () => {
    it('devuelve el precio local configurado', () => {
      expect(getPriceForCountry('CO', 'business')).toBe(PRICES_BY_COUNTRY.CO.business);
      expect(getPriceForCountry('MX', 'starter')).toBe(PRICES_BY_COUNTRY.MX.starter);
    });

    it('cae a DEFAULT para un país desconocido', () => {
      expect(getPriceForCountry('DEFAULT', 'starter')).toBe(PRICES_BY_COUNTRY.DEFAULT.starter);
    });

    it('cae al monto USD para monedas que Paddle no soporta', () => {
      expect(getPriceForCountry('BO', 'business')).toBe(PRICES_BY_COUNTRY.DEFAULT.business);
      expect(getPriceForCountry('PY', 'starter')).toBe(PRICES_BY_COUNTRY.DEFAULT.starter);
      expect(getPriceForCountry('VE', 'business')).toBe(PRICES_BY_COUNTRY.DEFAULT.business);
    });
  });

  describe('getDisplayPrice', () => {
    it('en Argentina usa el precio de planes (con promos)', () => {
      // El precio de planes vive en prices.json; basta con que sea > 0 y no el
      // de la tabla por país.
      expect(getDisplayPrice('AR', 'business')).toBeGreaterThan(0);
    });

    it('fuera de Argentina usa el precio local de la tabla', () => {
      expect(getDisplayPrice('CO', 'business')).toBe(PRICES_BY_COUNTRY.CO.business);
      expect(getDisplayPrice('MX', 'starter')).toBe(PRICES_BY_COUNTRY.MX.starter);
    });
  });

  describe('formatPriceByCountry', () => {
    it('formatea con la moneda del país', () => {
      const co = formatPriceByCountry({ amount: 109000, country: 'CO' });
      expect(co).toMatch(/109\.000/);
      const mx = formatPriceByCountry({ amount: 449, country: 'MX' });
      expect(mx).toMatch(/449/);
    });

    it('usa la moneda e importe correctos (no el monto en ARS)', () => {
      // Regresión: antes se formateaba el monto en ARS con el símbolo local.
      const co = formatPriceByCountry({ amount: getPriceForCountry('CO', 'business'), country: 'CO' });
      expect(co).toMatch(/109\.000/);
      expect(co).not.toMatch(/29\.900/);
    });

    it('formatea en USD para monedas que Paddle no soporta', () => {
      const py = formatPriceByCountry({ amount: getPriceForCountry('PY', 'starter'), country: 'PY' });
      // El monto es el USD de DEFAULT (17), no el local (129000 PYG).
      expect(py).not.toMatch(/129\.000/);
      expect(py).toMatch(/17/);
    });

    it('devuelve "A medida" para 0', () => {
      expect(formatPriceByCountry({ amount: 0, country: 'AR' })).toBe('A medida');
    });
  });
});
