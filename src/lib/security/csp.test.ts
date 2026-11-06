import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCsp } from '@/lib/security/csp';

describe('buildCsp: Sentry', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('permite solo el host exacto del DSN, no wildcards', () => {
    vi.stubEnv('SENTRY_DSN', 'https://clave@o456.ingest.sentry.io/123');
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', '');

    const csp = buildCsp('nonce-test');

    expect(csp).toContain('https://o456.ingest.sentry.io');
    expect(csp).not.toContain('*.ingest.sentry.io');
    expect(csp).not.toContain('*.ingest.us.sentry.io');
    expect(csp).not.toContain('*.ingest.de.sentry.io');
  });

  it('usa NEXT_PUBLIC_SENTRY_DSN cuando no hay SENTRY_DSN', () => {
    vi.stubEnv('SENTRY_DSN', '');
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'https://clave@o789.ingest.us.sentry.io/456');

    const csp = buildCsp('nonce-test');

    expect(csp).toContain('https://o789.ingest.us.sentry.io');
    expect(csp).not.toContain('*.ingest.sentry.io');
  });

  it('no agrega ningun host de Sentry si no hay DSN', () => {
    vi.stubEnv('SENTRY_DSN', '');
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', '');

    const csp = buildCsp('nonce-test');

    expect(csp).not.toContain('sentry.io');
  });

  it('ignora un DSN mal formado en vez de romper la policy', () => {
    vi.stubEnv('SENTRY_DSN', 'esto-no-es-un-dsn');
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', '');

    const csp = buildCsp('nonce-test');

    expect(csp).toContain("default-src 'self'");
    expect(csp).not.toContain('sentry.io');
  });
});
