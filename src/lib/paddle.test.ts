import crypto from 'crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getPaddlePriceId,
  isPaddleConfigured,
  verifyPaddleSignature,
} from './paddle';

const ENV_KEYS = [
  'PADDLE_API_KEY',
  'PADDLE_WEBHOOK_SECRET',
  'PADDLE_PRICE_IDS',
  'PADDLE_ENVIRONMENT',
  'NODE_ENV',
] as const;

const original: Record<string, string | undefined> = {};

function sign(secret: string, ts: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(`${ts}:${body}`).digest('hex');
}

// `process.env.NODE_ENV` es readonly en los tipos de Next; el cast deja
// setear/restaurar el entorno en los tests sin romper el typecheck.
function setEnv(key: string, value: string | undefined) {
  const env = process.env as Record<string, string | undefined>;
  if (value === undefined) delete env[key];
  else env[key] = value;
}

describe('paddle', () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      original[key] = process.env[key];
      setEnv(key, undefined);
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      setEnv(key, original[key]);
    }
  });

  describe('isPaddleConfigured', () => {
    it('es false sin API key', () => {
      expect(isPaddleConfigured()).toBe(false);
    });

    it('es true con API key', () => {
      process.env.PADDLE_API_KEY = 'pdl_sdbx_apikey_x';
      expect(isPaddleConfigured()).toBe(true);
    });
  });

  describe('getPaddlePriceId', () => {
    it('devuelve null sin config', () => {
      expect(getPaddlePriceId('COP', 'starter')).toBeNull();
    });

    it('lee el price id por moneda y plan (case-insensitive)', () => {
      process.env.PADDLE_PRICE_IDS = JSON.stringify({
        COP: { starter: 'pri_cop_starter', business: 'pri_cop_business' },
        USD: { starter: 'pri_usd_starter', business: 'pri_usd_business' },
      });
      expect(getPaddlePriceId('cop', 'business')).toBe('pri_cop_business');
      expect(getPaddlePriceId('USD', 'starter')).toBe('pri_usd_starter');
    });

    it('NO cae a USD si la moneda no tiene precio (la resuelve el caller)', () => {
      // La resolución moneda-local→USD la hace `getCurrencyForCountry` con el
      // set de monedas configuradas. Acá no puede haber fallback: si cayera a
      // USD, se cobraría una moneda distinta a la mostrada.
      process.env.PADDLE_PRICE_IDS = JSON.stringify({
        USD: { starter: 'pri_usd_starter', business: 'pri_usd_business' },
      });
      expect(getPaddlePriceId('GTQ', 'starter')).toBeNull();
    });

    it('ignora un JSON inválido', () => {
      process.env.PADDLE_PRICE_IDS = 'no-es-json';
      expect(getPaddlePriceId('USD', 'starter')).toBeNull();
    });
  });

  describe('verifyPaddleSignature', () => {
    const body = JSON.stringify({ event_id: 'evt_1', event_type: 'subscription.created' });
    const secret = 'pdl_ntfset_secret';

    it('acepta una firma válida', () => {
      process.env.PADDLE_WEBHOOK_SECRET = secret;
      const ts = String(Math.floor(Date.now() / 1000));
      const header = `ts=${ts};h1=${sign(secret, ts, body)}`;
      expect(verifyPaddleSignature(body, header)).toBe(true);
    });

    it('rechaza una firma alterada', () => {
      process.env.PADDLE_WEBHOOK_SECRET = secret;
      const ts = String(Math.floor(Date.now() / 1000));
      const header = `ts=${ts};h1=${sign(secret, ts, body + 'x')}`;
      expect(verifyPaddleSignature(body, header)).toBe(false);
    });

    it('rechaza un secreto distinto', () => {
      process.env.PADDLE_WEBHOOK_SECRET = secret;
      const ts = String(Math.floor(Date.now() / 1000));
      const header = `ts=${ts};h1=${sign('otro-secreto', ts, body)}`;
      expect(verifyPaddleSignature(body, header)).toBe(false);
    });

    it('rechaza un timestamp viejo (replay)', () => {
      process.env.PADDLE_WEBHOOK_SECRET = secret;
      const ts = String(Math.floor(Date.now() / 1000) - 10 * 60);
      const header = `ts=${ts};h1=${sign(secret, ts, body)}`;
      expect(verifyPaddleSignature(body, header)).toBe(false);
    });

    it('acepta cuando hay varios h1 (rotación) y uno coincide', () => {
      process.env.PADDLE_WEBHOOK_SECRET = secret;
      const ts = String(Math.floor(Date.now() / 1000));
      const header = `ts=${ts};h1=deadbeef;h1=${sign(secret, ts, body)}`;
      expect(verifyPaddleSignature(body, header)).toBe(true);
    });

    it('rechaza header ausente o malformado', () => {
      process.env.PADDLE_WEBHOOK_SECRET = secret;
      expect(verifyPaddleSignature(body, null)).toBe(false);
      expect(verifyPaddleSignature(body, 'h1=abc')).toBe(false);
      expect(verifyPaddleSignature(body, 'ts=abc;h1=abc')).toBe(false);
    });

    it('rechaza en producción sin secreto', () => {
      setEnv('NODE_ENV', 'production');
      expect(verifyPaddleSignature(body, 'ts=1;h1=abc')).toBe(false);
    });

    it('permite el bypass en desarrollo sin secreto', () => {
      setEnv('NODE_ENV', 'test');
      expect(verifyPaddleSignature(body, null)).toBe(true);
    });
  });
});
