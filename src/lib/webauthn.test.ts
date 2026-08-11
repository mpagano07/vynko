import { describe, expect, it, beforeEach } from 'vitest';
import {
  getStoredCredential,
  clearStoredCredential,
  getStoredRefreshToken,
  clearStoredRefreshToken,
  storeRefreshToken,
  isWebAuthnSupported,
  isMobileDevice,
} from './webauthn';

describe('webauthn helper utilities', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('guarda y recupera el refresh token biométrico en localStorage', () => {
    expect(getStoredRefreshToken()).toBeNull();

    storeRefreshToken('sample-refresh-token-123');
    expect(getStoredRefreshToken()).toBe('sample-refresh-token-123');

    clearStoredRefreshToken();
    expect(getStoredRefreshToken()).toBeNull();
  });

  it('limpia credenciales biométricas guardadas', () => {
    const cred = { credentialId: 'c-1', deviceName: 'Phone', createdAt: Date.now() };
    localStorage.setItem('vynko_biometric', JSON.stringify(cred));

    expect(getStoredCredential()).toEqual(cred);

    clearStoredCredential();
    expect(getStoredCredential()).toBeNull();
  });

  it('valida detección de dispositivo móvil mediante User Agent', () => {
    const originalUA = window.navigator.userAgent;

    Object.defineProperty(window.navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36',
      configurable: true,
    });
    expect(isMobileDevice()).toBe(true);

    Object.defineProperty(window.navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      configurable: true,
    });
    expect(isMobileDevice()).toBe(false);

    Object.defineProperty(window.navigator, 'userAgent', {
      value: originalUA,
      configurable: true,
    });
  });

  it('detecta soporte de WebAuthn en el navegador', () => {
    expect(typeof isWebAuthnSupported()).toBe('boolean');
  });
});
