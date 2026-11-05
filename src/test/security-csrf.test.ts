import { describe, it, expect, vi, afterEach } from 'vitest';
import { isCrossSiteRequest, isSameOriginRequest } from '@/lib/security/csrf';

afterEach(() => {
  vi.unstubAllEnvs();
});

function makeRequest(url: string, init: RequestInit & { headers?: Record<string, string> } = {}): Request {
  return new Request(url, init);
}

describe('isSameOriginRequest', () => {
  it('always allows safe methods', () => {
    expect(isSameOriginRequest(makeRequest('https://app.test/x', { method: 'GET' }))).toBe(true);
    expect(
      isSameOriginRequest(
        makeRequest('https://app.test/x', { method: 'HEAD', headers: { 'sec-fetch-site': 'cross-site' } })
      )
    ).toBe(true);
    expect(
      isSameOriginRequest(
        makeRequest('https://app.test/x', { method: 'OPTIONS', headers: { origin: 'https://evil.test' } })
      )
    ).toBe(true);
  });

  it('rejects cross-site mutations flagged by sec-fetch-site', () => {
    const request = makeRequest('https://app.test/api/x', {
      method: 'POST',
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    expect(isSameOriginRequest(request)).toBe(false);
  });

  it('rejects a same-site subdomain when the Origin does not match exactly', () => {
    // `same-site` incluye subdominios: evil.app.test y app.test son same-site.
    // No alcanza con el header, hay que validar el Origin.
    const request = makeRequest('https://app.test/api/x', {
      method: 'POST',
      headers: { origin: 'https://evil.app.test', 'sec-fetch-site': 'same-site' },
    });
    expect(isSameOriginRequest(request)).toBe(false);
  });

  it('accepts same-site only when the Origin matches exactly', () => {
    const request = makeRequest('https://app.test/api/x', {
      method: 'POST',
      headers: { origin: 'https://app.test', 'sec-fetch-site': 'same-site' },
    });
    expect(isSameOriginRequest(request)).toBe(true);
  });

  it('rejects same-site without Origin instead of trusting the flag', () => {
    const request = makeRequest('https://app.test/api/x', {
      method: 'POST',
      headers: { 'sec-fetch-site': 'same-site' },
    });
    expect(isSameOriginRequest(request)).toBe(false);
  });

  it('allows same-origin mutations', () => {
    const request = makeRequest('https://app.test/api/x', {
      method: 'POST',
      headers: { origin: 'https://app.test', 'sec-fetch-site': 'same-origin' },
    });
    expect(isSameOriginRequest(request)).toBe(true);
  });

  it('rejects a foreign Origin header', () => {
    const request = makeRequest('https://app.test/api/x', {
      method: 'POST',
      headers: { origin: 'https://evil.test', host: 'app.test' },
    });
    expect(isSameOriginRequest(request)).toBe(false);
  });

  it('rejects the opaque "null" origin', () => {
    const request = makeRequest('https://app.test/api/x', {
      method: 'POST',
      headers: { origin: 'null' },
    });
    expect(isSameOriginRequest(request)).toBe(false);
  });

  it('matches the request origin derived from forwarded headers', () => {
    const request = makeRequest('https://internal.test/api/x', {
      method: 'POST',
      headers: {
        origin: 'https://app.test',
        'x-forwarded-host': 'app.test',
        'x-forwarded-proto': 'https',
      },
    });
    expect(isSameOriginRequest(request)).toBe(true);
  });

  it('does not reject non-browser clients that omit Origin', () => {
    const request = makeRequest('https://app.test/api/x', { method: 'POST', headers: { host: 'app.test' } });
    expect(isSameOriginRequest(request)).toBe(true);
  });

  it('accepts local development origins without x-forwarded-proto', () => {
    const request = makeRequest('http://localhost:3000/api/x', {
      method: 'POST',
      headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
    });
    expect(isSameOriginRequest(request)).toBe(true);
  });

  it('accepts the configured public origin behind a host-rewriting proxy', () => {
    // Con un proxy que no reenvía x-forwarded-host, `request.url` puede reflejar
    // un host interno. El Origin del navegador sigue siendo el sitio público.
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://app.test');
    const request = makeRequest('http://internal:3000/api/x', {
      method: 'POST',
      headers: { origin: 'https://app.test', host: 'internal:3000' },
    });
    expect(isSameOriginRequest(request)).toBe(true);
  });

  it('still rejects an origin that is not the configured one', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://app.test');
    const request = makeRequest('http://internal:3000/api/x', {
      method: 'POST',
      headers: { origin: 'https://evil.test', host: 'internal:3000' },
    });
    expect(isSameOriginRequest(request)).toBe(false);
  });
});

describe('isCrossSiteRequest', () => {
  it('does not let a same-origin flag hide a foreign Origin', () => {
    // Regresion: antes cualquier `sec-fetch-site` presente ganaba y se confiaba
    // en `same-origin`, aunque el Origin dijera otra cosa.
    const forged = makeRequest('https://app.test/api/x', {
      method: 'POST',
      headers: { 'sec-fetch-site': 'same-origin', origin: 'https://evil.test' },
    });
    expect(isCrossSiteRequest(forged)).toBe(true);
  });

  it('rejects a malformed origin', () => {
    const request = makeRequest('https://app.test/api/x', {
      method: 'POST',
      headers: { origin: 'not-a-url', host: 'app.test' },
    });
    expect(isCrossSiteRequest(request)).toBe(true);
  });
});
