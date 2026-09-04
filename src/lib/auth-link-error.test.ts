import { afterEach, describe, expect, it } from 'vitest';
import { clearAuthLinkErrorFromUrl, getAuthLinkErrorParams } from './auth-link-error';

afterEach(() => {
  window.history.replaceState({}, '', '/');
});

describe('getAuthLinkErrorParams', () => {
  it('detecta el error de link PKCE expirado en el query', () => {
    window.history.replaceState(
      {},
      '',
      '/?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
    );

    expect(getAuthLinkErrorParams()).toEqual({
      error: 'access_denied',
      errorCode: 'otp_expired',
      description: 'Email link is invalid or has expired',
    });
  });

  it('detecta el error si viene solo en el hash de auth', () => {
    window.history.replaceState({}, '', '/#error=access_denied&error_code=otp_expired&error_description=x&sb=');

    expect(getAuthLinkErrorParams()).toEqual({
      error: 'access_denied',
      errorCode: 'otp_expired',
      description: 'x',
    });
  });

  it('ignora errores de la app (p.ej. /login?error=missing_code)', () => {
    window.history.replaceState({}, '', '/login?error=missing_code');

    expect(getAuthLinkErrorParams()).toBeNull();
  });

  it('devuelve null sin parámetros de error', () => {
    window.history.replaceState({}, '', '/dashboard');

    expect(getAuthLinkErrorParams()).toBeNull();
  });
});

describe('clearAuthLinkErrorFromUrl', () => {
  it('limpia el query y el hash del error de auth', () => {
    window.history.replaceState(
      {},
      '',
      '/?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&sb=',
    );

    clearAuthLinkErrorFromUrl();

    expect(window.location.pathname).toBe('/');
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('');
  });

  it('no toca la URL si no hay error de auth link', () => {
    window.history.replaceState({}, '', '/?utm_source=email#features');

    clearAuthLinkErrorFromUrl();

    expect(window.location.search).toBe('?utm_source=email');
    expect(window.location.hash).toBe('#features');
  });
});