import { describe, it, expect } from 'vitest';
import { isCrossSiteRequest, isSameOriginRequest } from '@/lib/security/csrf';

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
});

describe('isCrossSiteRequest', () => {
  it('prefers sec-fetch-site when present', () => {
    const sameSiteHeader = makeRequest('https://app.test/api/x', {
      method: 'POST',
      headers: { 'sec-fetch-site': 'same-origin', origin: 'https://evil.test' },
    });
    expect(isCrossSiteRequest(sameSiteHeader)).toBe(false);
  });

  it('rejects a malformed origin', () => {
    const request = makeRequest('https://app.test/api/x', {
      method: 'POST',
      headers: { origin: 'not-a-url', host: 'app.test' },
    });
    expect(isCrossSiteRequest(request)).toBe(true);
  });
});
