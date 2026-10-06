import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getSentryDsn,
  isSentryEnabled,
  scrubEvent,
} from './scrub';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('scrubEvent', () => {
  it('redacta headers de credenciales y sesion', () => {
    const event = scrubEvent({
      request: {
        url: 'https://app.example.com/api/products',
        method: 'GET',
        headers: {
          cookie: 'sb-access-token=eyJ...',
          authorization: 'Bearer eyJhbGciOiJIUzI1NiIs...',
          'x-supabase-auth': 'eyJhbGciOiJIUzI1NiJ9...',
          'accept-language': 'es-AR',
        },
      },
    });

    expect(event.request?.headers).toEqual({
      cookie: '[Filtered]',
      authorization: '[Filtered]',
      'x-supabase-auth': '[Filtered]',
      'accept-language': 'es-AR',
    });
  });

  it('redacta el valor de cada cookie conservando el nombre', () => {
    const event = scrubEvent({
      request: {
        url: 'https://app.example.com/',
        method: 'GET',
        cookies: { session: 's3cr3t', uid: 'abc', prefs: 'ligth' },
      },
    });

    expect(event.request?.cookies).toEqual({
      session: '[Filtered]',
      uid: '[Filtered]',
      prefs: '[Filtered]',
    });
  });

  it('redacta keys con nombre sensitivo en extra, de forma recursiva', () => {
    const event = scrubEvent({
      extra: {
        api_key: 'k-api',
        accessToken: 'tok',
        tenant_stock_token: 'pa-t1',
        payload: {
          billing: { google_oauth: { refresh_token: 'rt-1' } },
          products: [{ sku: 'A1', price: 1200 }],
        },
        description: 'free text',
      },
    });

    expect(event.extra).toEqual({
      api_key: '[Filtered]',
      accessToken: '[Filtered]',
      tenant_stock_token: '[Filtered]',
      payload: {
        billing: { google_oauth: { refresh_token: '[Filtered]' } },
        products: [{ sku: 'A1', price: 1200 }],
      },
      description: 'free text',
    });
  });

  it('redacta contexts con tokens anidados en arrays', () => {
    const event = scrubEvent({
      contexts: {
        mercadopago: { transactions: [{ id: 't1', transaction_secret: 'x' }] },
      },
    });

    expect(event.contexts).toEqual({
      mercadopago: { transactions: [{ id: 't1', transaction_secret: '[Filtered]' }] },
    });
  });

  it('redacta PII del user sin borrar el id', () => {
    const event = scrubEvent({
      user: {
        id: 'u-123',
        email: 'owner@acme.com',
        username: 'owner',
        ip_address: '200.100.50.10',
      },
    });

    expect(event.user).toEqual({
      id: 'u-123',
      email: '[Filtered]',
      username: '[Filtered]',
      ip_address: '[Filtered]',
    });
  });

  it('conserva la url', () => {
    const url = 'https://app.example.com/api/products?sku=A1';
    const event = scrubEvent({ request: { url, method: 'GET' } });

    expect(event.request?.url).toBe(url);
  });
});

describe('getSentryDsn / isSentryEnabled', () => {
  it('SENTRY_DSN gana sobre NEXT_PUBLIC_SENTRY_DSN', () => {
    vi.stubEnv('SENTRY_DSN', 'dsn-server');
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'dsn-public');

    expect(getSentryDsn()).toBe('dsn-server');
    expect(isSentryEnabled()).toBe(true);
  });

  it('sin DSN queda deshabilitado', () => {
    expect(getSentryDsn()).toBeUndefined();
    expect(isSentryEnabled()).toBe(false);
  });
});