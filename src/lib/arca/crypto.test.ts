import { describe, it, expect, vi } from 'vitest';
import {
  encryptSensitiveText,
  decryptSensitiveText,
  normalizePem,
  isValidCertificatePem,
  isValidPrivateKeyPem,
} from './crypto';

describe('arca crypto', () => {
  it('encrypts and decrypts text accurately with AES-256-GCM', () => {
    const secret = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----';
    const encryptedPayload = encryptSensitiveText(secret);

    expect(encryptedPayload.encrypted).toBeDefined();
    expect(encryptedPayload.iv).toBeDefined();
    expect(encryptedPayload.tag).toBeDefined();
    expect(encryptedPayload.encrypted).not.toBe(secret);

    const decrypted = decryptSensitiveText(encryptedPayload);
    expect(decrypted).toBe(secret);
  });

  it('normalizes carriage returns in PEM strings', () => {
    const raw = 'line1\r\nline2\rline3\n';
    const normalized = normalizePem(raw);
    expect(normalized).toBe('line1\nline2\nline3');
  });

  it('validates X.509 certificate PEM syntax', () => {
    expect(isValidCertificatePem('-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----')).toBe(true);
    expect(isValidCertificatePem('invalid certificate data')).toBe(false);
  });

  it('validates RSA private key PEM syntax', () => {
    expect(isValidPrivateKeyPem('-----BEGIN RSA PRIVATE KEY-----\nKEY\n-----END RSA PRIVATE KEY-----')).toBe(true);
    expect(isValidPrivateKeyPem('-----BEGIN PRIVATE KEY-----\nKEY\n-----END PRIVATE KEY-----')).toBe(true);
    expect(isValidPrivateKeyPem('some random string')).toBe(false);
  });

  it('falla cerrado si no hay ARCA_ENCRYPTION_KEY', () => {
    vi.stubEnv('ARCA_ENCRYPTION_KEY', '');
    expect(() => encryptSensitiveText('secret')).toThrow(/ARCA_ENCRYPTION_KEY/);
  });
});
