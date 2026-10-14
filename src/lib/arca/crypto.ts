import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM

/**
 * Derives a 32-byte key for AES-256-GCM from ARCA_ENCRYPTION_KEY.
 *
 * Fail-closed: si no hay una clave maestra configurada NO se usa un default
 * conocido. Sin esto, cualquiera con acceso a la DB y al repositorio podría
 * descifrar las claves privadas de ARCA de los comercios.
 */
function getMasterKey(): Buffer {
  const secret = process.env.ARCA_ENCRYPTION_KEY;
  if (!secret || secret.trim().length < 16) {
    throw new Error(
      'ARCA_ENCRYPTION_KEY no está configurada o es demasiado corta (mínimo 16 caracteres). ' +
        'Definila en el entorno antes de cifrar/descifrar credenciales de ARCA.'
    );
  }
  return crypto.createHash('sha256').update(secret).digest();
}

export interface EncryptedPayload {
  encrypted: string; // Hex
  iv: string; // Hex
  tag: string; // Hex
}

/**
 * Encrypts sensitive text (e.g., RSA private key) using AES-256-GCM.
 */
export function encryptSensitiveText(plaintext: string): EncryptedPayload {
  const masterKey = getMasterKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, masterKey, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const tag = cipher.getAuthTag();

  return {
    encrypted,
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
  };
}

/**
 * Decrypts text previously encrypted with encryptSensitiveText.
 */
export function decryptSensitiveText(payload: {
  encrypted: string;
  iv: string;
  tag: string;
}): string {
  const masterKey = getMasterKey();
  const iv = Buffer.from(payload.iv, 'hex');
  const tag = Buffer.from(payload.tag, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, masterKey, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(payload.encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Cleans and normalizes PEM string formatting (uniform \n line breaks).
 */
export function normalizePem(raw: string): string {
  return raw
    .trim()
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

/**
 * Basic syntax validation for X.509 Certificate PEM.
 */
export function isValidCertificatePem(pem: string): boolean {
  const normalized = normalizePem(pem);
  return (
    normalized.includes('-----BEGIN CERTIFICATE-----') &&
    normalized.includes('-----END CERTIFICATE-----')
  );
}

/**
 * Basic syntax validation for RSA Private Key PEM (PKCS#1 or PKCS#8).
 */
export function isValidPrivateKeyPem(pem: string): boolean {
  const normalized = normalizePem(pem);
  return (
    (normalized.includes('-----BEGIN RSA PRIVATE KEY-----') &&
      normalized.includes('-----END RSA PRIVATE KEY-----')) ||
    (normalized.includes('-----BEGIN PRIVATE KEY-----') &&
      normalized.includes('-----END PRIVATE KEY-----'))
  );
}
