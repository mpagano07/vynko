import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveCookieConsent, CONSENT_COOKIE } from '@/lib/cookie-consent';
import { trackClientEvent } from '@/lib/analytics-client';

const authFetchMock = vi.hoisted(() => vi.fn(async () => new Response('{}')));

vi.mock('@/lib/fetchWithTenant', () => ({
  authFetch: (...args: unknown[]) => authFetchMock(...args),
}));

function setConsent(prefs: { functional: boolean; analytics: boolean; marketing: boolean }) {
  saveCookieConsent(prefs);
}

describe('trackClientEvent', () => {
  beforeEach(() => {
    authFetchMock.mockClear();
    document.cookie = `${CONSENT_COOKIE}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
  });

  it('no envía nada si no hay consentimiento', () => {
    trackClientEvent('forecast_opened');
    expect(authFetchMock).not.toHaveBeenCalled();
  });

  it('no envía nada si el consentimiento analítico es false', () => {
    setConsent({ functional: true, analytics: false, marketing: false });
    trackClientEvent('forecast_opened');
    expect(authFetchMock).not.toHaveBeenCalled();
  });

  it('envía el evento cuando el consentimiento analítico es true', () => {
    setConsent({ functional: true, analytics: true, marketing: false });
    trackClientEvent('whatsapp_ticket', { saleId: 's1' });

    expect(authFetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = authFetchMock.mock.calls[0] as [string, { body: string }];
    expect(url).toBe('/api/analytics/track');
    expect(JSON.parse(init.body)).toMatchObject({
      type: 'whatsapp_ticket',
      metadata: { saleId: 's1' },
    });
  });
});
