import { describe, it, expect } from 'vitest';
import { getAppOrigin, safeInternalRedirect } from '@/lib/security/redirects';

function req(headers: Record<string, string> = {}, url = 'https://internal.test/auth/callback'): Request {
  return new Request(url, { headers });
}

describe('getAppOrigin', () => {
  it('prefers the configured public site url', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://app.vynko.com';
    try {
      expect(getAppOrigin(req({ host: 'attacker.test' }))).toBe('https://app.vynko.com');
    } finally {
      delete process.env.NEXT_PUBLIC_SITE_URL;
    }
  });

  it('prefers the request url origin over forwarded headers', () => {
    // Los headers `x-forwarded-*` son controlados por el cliente si el proxy
    // no los sanea: la URL de la request tiene precedencia.
    expect(getAppOrigin(req({ 'x-forwarded-host': 'attacker.test', 'x-forwarded-proto': 'https' }))).toBe(
      'https://internal.test'
    );
  });

  it('uses forwarded headers only when the request url has no origin', () => {
    const request = { url: '', headers: new Headers({ 'x-forwarded-host': 'app.vynko.com', 'x-forwarded-proto': 'https' }) };
    expect(getAppOrigin(request as unknown as Request)).toBe('https://app.vynko.com');
  });

  it('ignores malformed host headers', () => {
    expect(getAppOrigin(req({ host: 'evil.test/path?x=1' }, 'https://fallback.test/x'))).toBe(
      'https://fallback.test'
    );
  });

  it('falls back to localhost when nothing usable is available', () => {
    const request = { url: '', headers: new Headers({ host: 'evil.test/path' }) };
    expect(getAppOrigin(request as unknown as Request)).toBe('http://localhost:3000');
  });
});

describe('safeInternalRedirect', () => {
  const request = req({ host: 'app.vynko.com', 'x-forwarded-proto': 'https' }, 'https://app.vynko.com/auth/callback');

  it('allows internal paths', () => {
    expect(safeInternalRedirect(request, '/dashboard')).toBe('https://app.vynko.com/dashboard');
    expect(safeInternalRedirect(request, '/ventas?filtro=1#top')).toBe(
      'https://app.vynko.com/ventas?filtro=1#top'
    );
  });

  it('rejects absolute cross-origin urls (open redirect)', () => {
    expect(safeInternalRedirect(request, 'https://evil.test/steal')).toBe('https://app.vynko.com/dashboard');
    expect(safeInternalRedirect(request, '//evil.test/steal')).toBe('https://app.vynko.com/dashboard');
    expect(safeInternalRedirect(request, 'https://app.vynko.com.evil.test/x')).toBe(
      'https://app.vynko.com/dashboard'
    );
  });

  it('rejects non-http protocols', () => {
    expect(safeInternalRedirect(request, 'javascript:alert(1)')).toBe('https://app.vynko.com/dashboard');
    expect(safeInternalRedirect(request, 'data:text/html,<script>alert(1)</script>')).toBe(
      'https://app.vynko.com/dashboard'
    );
  });

  it('falls back when no target is provided', () => {
    expect(safeInternalRedirect(request, null, '/login?error=x')).toBe(
      'https://app.vynko.com/login?error=x'
    );
  });
});
