import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { CONSENT_COOKIE, saveCookieConsent } from '@/lib/cookie-consent';

const pathname = vi.hoisted(() => ({ current: '/' }));
const track = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  usePathname: () => pathname.current,
}));

vi.mock('@vercel/analytics/next', () => ({
  Analytics: () => <div data-testid="vercel-analytics" />,
}));

vi.mock('@vercel/analytics', () => ({ track }));

import { ConsentAnalytics } from './consent-analytics';

describe('ConsentAnalytics', () => {
  beforeEach(() => {
    document.cookie = `${CONSENT_COOKIE}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
    pathname.current = '/';
    window.history.replaceState({}, '', '/');
    track.mockClear();
  });

  it('no renderiza Analytics sin consentimiento', () => {
    render(<ConsentAnalytics />);
    expect(screen.queryByTestId('vercel-analytics')).toBeNull();
  });

  it('no renderiza Analytics si el consentimiento analítico es false', () => {
    saveCookieConsent({ functional: true, analytics: false, marketing: false });
    render(<ConsentAnalytics />);
    expect(screen.queryByTestId('vercel-analytics')).toBeNull();
  });

  it('renderiza Analytics con consentimiento analítico en una ruta indexable', () => {
    saveCookieConsent({ functional: true, analytics: true, marketing: false });
    render(<ConsentAnalytics />);
    expect(screen.getByTestId('vercel-analytics')).toBeInTheDocument();
  });

  it('se activa cuando el usuario acepta las analíticas', () => {
    render(<ConsentAnalytics />);

    act(() => {
      saveCookieConsent({ functional: true, analytics: true, marketing: false });
    });

    expect(screen.getByTestId('vercel-analytics')).toBeInTheDocument();
  });

  it('no renderiza Analytics en rutas privadas', () => {
    saveCookieConsent({ functional: true, analytics: true, marketing: false });
    pathname.current = '/dashboard';
    render(<ConsentAnalytics />);
    expect(screen.queryByTestId('vercel-analytics')).toBeNull();
  });

  it('registra una visita de Instagram con sus parámetros UTM', async () => {
    window.history.replaceState(
      {},
      '',
      '/?utm_source=instagram&utm_campaign=bio&utm_content=post_01'
    );
    saveCookieConsent({ functional: true, analytics: true, marketing: false });
    render(<ConsentAnalytics />);

    await waitFor(() =>
      expect(track).toHaveBeenCalledWith('instagram_visit', {
        campaign: 'bio',
        content: 'post_01',
      })
    );
  });

  it('no registra visitas de Instagram sin consentimiento', () => {
    window.history.replaceState({}, '', '/?utm_source=instagram');
    render(<ConsentAnalytics />);

    expect(track).not.toHaveBeenCalled();
  });

  it('no registra visitas de Instagram en rutas privadas', () => {
    window.history.replaceState({}, '', '/dashboard?utm_source=instagram');
    pathname.current = '/dashboard';
    saveCookieConsent({ functional: true, analytics: true, marketing: false });
    render(<ConsentAnalytics />);

    expect(track).not.toHaveBeenCalled();
  });
});
