import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getPaddleConfiguredCurrencies, parsePriceIds } from './paddle-price-ids';

const original = process.env.PADDLE_PRICE_IDS;

function setPriceIds(value: string | undefined) {
  const env = process.env as Record<string, string | undefined>;
  if (value === undefined) delete env.PADDLE_PRICE_IDS;
  else env.PADDLE_PRICE_IDS = value;
}

describe('paddle-price-ids', () => {
  beforeEach(() => {
    setPriceIds(undefined);
  });

  afterEach(() => {
    setPriceIds(original);
  });

  describe('parsePriceIds', () => {
    it('devuelve {} sin config', () => {
      expect(parsePriceIds()).toEqual({});
    });

    it('parsea el JSON de precios', () => {
      setPriceIds(
        JSON.stringify({ COP: { starter: 'pri_cop_starter' }, USD: { starter: 'pri_usd_starter' } })
      );
      expect(parsePriceIds()).toEqual({
        COP: { starter: 'pri_cop_starter' },
        USD: { starter: 'pri_usd_starter' },
      });
    });

    it('devuelve {} con JSON inválido', () => {
      setPriceIds('no-es-json');
      expect(parsePriceIds()).toEqual({});
    });
  });

  describe('getPaddleConfiguredCurrencies', () => {
    it('devuelve [] sin config', () => {
      expect(getPaddleConfiguredCurrencies()).toEqual([]);
    });

    it('devuelve las monedas con al menos un precio, en mayúsculas', () => {
      setPriceIds(
        JSON.stringify({
          cop: { starter: 'pri_cop_starter', business: 'pri_cop_business' },
          USD: { starter: 'pri_usd_starter' },
        })
      );
      expect(getPaddleConfiguredCurrencies().sort()).toEqual(['COP', 'USD']);
    });

    it('ignora una moneda sin ningún plan cargado', () => {
      // Una entrada vacía (o con valores vacíos) no habilita la moneda: si no
      // hay `price_id`, el país se muestra y se cobra en USD.
      setPriceIds(
        JSON.stringify({
          COP: {},
          MXN: { starter: '', business: '' },
          USD: { starter: 'pri_usd_starter' },
        })
      );
      expect(getPaddleConfiguredCurrencies()).toEqual(['USD']);
    });
  });
});
