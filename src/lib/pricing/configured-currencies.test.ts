import { afterEach, describe, expect, it } from 'vitest';
import {
  PADDLE_CURRENCIES_COOKIE,
  getConfiguredCurrenciesFromCookie,
  parseConfiguredCurrencies,
} from './configured-currencies';

afterEach(() => {
  // Limpia la cookie entre tests (expira inmediatamente).
  document.cookie = `${PADDLE_CURRENCIES_COOKIE}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
});

describe('parseConfiguredCurrencies', () => {
  it('devuelve null sin valor (el caller decide el default)', () => {
    expect(parseConfiguredCurrencies(undefined)).toBeNull();
    expect(parseConfiguredCurrencies(null)).toBeNull();
  });

  it('devuelve un set vacío si la cookie existe pero está vacía', () => {
    // Distinto de "sin cookie": significa "cero monedas configuradas", y el
    // display cae a USD.
    const set = parseConfiguredCurrencies('');
    expect(set).not.toBeNull();
    expect(set?.size).toBe(0);
  });

  it('parsea y normaliza a mayúsculas', () => {
    const set = parseConfiguredCurrencies('usd, cop , MXN');
    expect([...(set ?? [])].sort()).toEqual(['COP', 'MXN', 'USD']);
  });
});

describe('getConfiguredCurrenciesFromCookie', () => {
  it('lee la cookie del navegador', () => {
    document.cookie = `${PADDLE_CURRENCIES_COOKIE}=USD,COP; path=/`;
    const set = getConfiguredCurrenciesFromCookie();
    expect([...(set ?? [])].sort()).toEqual(['COP', 'USD']);
  });

  it('devuelve null si no hay cookie', () => {
    expect(getConfiguredCurrenciesFromCookie()).toBeNull();
  });
});
