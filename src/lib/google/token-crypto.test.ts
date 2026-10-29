import { afterEach, describe, expect, it, vi } from 'vitest';
import { decryptGoogleToken, encryptGoogleToken } from './token-crypto';

describe('google token crypto', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('cifra y descifra el refresh token sin perder datos', () => {
    vi.stubEnv('GOOGLE_TOKEN_ENCRYPTION_KEY', 'clave-de-prueba-con-suficiente-entropia');

    const token = '1//0gRefreshTokenDeGoogleConCaracteres_Especiales-123';
    const encrypted = encryptGoogleToken(token);

    expect(encrypted.encrypted).not.toBe(token);
    expect(encrypted.iv).toBeTruthy();
    expect(encrypted.tag).toBeTruthy();
    expect(decryptGoogleToken(encrypted)).toBe(token);
  });

  it('genera un ciphertext distinto en cada cifrado', () => {
    vi.stubEnv('GOOGLE_TOKEN_ENCRYPTION_KEY', 'clave-de-prueba-con-suficiente-entropia');

    const a = encryptGoogleToken('mismo-token');
    const b = encryptGoogleToken('mismo-token');

    expect(a.encrypted).not.toBe(b.encrypted);
    expect(a.iv).not.toBe(b.iv);
  });

  it('rechaza un payload manipulado', () => {
    vi.stubEnv('GOOGLE_TOKEN_ENCRYPTION_KEY', 'clave-de-prueba-con-suficiente-entropia');

    const encrypted = encryptGoogleToken('token-original');
    const tampered = { ...encrypted, encrypted: `${encrypted.encrypted.slice(0, -2)}00` };

    expect(() => decryptGoogleToken(tampered)).toThrow();
  });

  it('falla cerrado si no hay ninguna clave configurada', () => {
    vi.stubEnv('GOOGLE_TOKEN_ENCRYPTION_KEY', '');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', '');

    expect(() => encryptGoogleToken('token')).toThrow(/GOOGLE_TOKEN_ENCRYPTION_KEY/);
  });
});
