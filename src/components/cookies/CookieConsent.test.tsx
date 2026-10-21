import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import CookieConsent from '@/components/cookies/CookieConsent';
import { getCookieConsent, saveCookieConsent, CONSENT_COOKIE } from '@/lib/cookie-consent';

describe('CookieConsent', () => {
  beforeEach(() => {
    document.cookie = `${CONSENT_COOKIE}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
  });

  it('muestra el banner cuando no hay consentimiento previo', () => {
    render(<CookieConsent />);
    expect(screen.getByText(/Usamos cookies esenciales/)).toBeInTheDocument();
  });

  it('"Rechazar" guarda todo opcional en false', () => {
    render(<CookieConsent />);

    fireEvent.click(screen.getByRole('button', { name: 'Rechazar' }));

    expect(getCookieConsent()).toMatchObject({
      necessary: true,
      functional: false,
      analytics: false,
      marketing: false,
    });
  });

  it('"Aceptar todas" habilita analíticas y marketing', () => {
    render(<CookieConsent />);

    fireEvent.click(screen.getByRole('button', { name: 'Aceptar todas' }));

    expect(getCookieConsent()).toMatchObject({
      functional: true,
      analytics: true,
      marketing: true,
    });
  });

  it('no renderiza si ya hay consentimiento guardado', () => {
    saveCookieConsent({ functional: true, analytics: false, marketing: false });
    const { container } = render(<CookieConsent />);
    expect(container.textContent).toBe('');
  });
});
