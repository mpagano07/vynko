import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

/**
 * Clave para cifrar el refresh token de Google Drive.
 *
 * Usa `GOOGLE_TOKEN_ENCRYPTION_KEY` si está definida; si no, deriva la clave
 * del `GOOGLE_CLIENT_SECRET` con un separador de dominio. El fallback evita
 * exigir una variable nueva, pero rotar el client secret invalida las
 * conexiones guardadas (el usuario vuelve a autorizar).
 */
function getMasterKey(): Buffer {
  const secret = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || process.env.GOOGLE_CLIENT_SECRET;
  if (!secret || secret.trim().length < 16) {
    throw new Error(
      'GOOGLE_TOKEN_ENCRYPTION_KEY (o GOOGLE_CLIENT_SECRET) no está configurada o es demasiado corta (mínimo 16 caracteres).'
    );
  }
  return crypto
    .createHash('sha256')
    .update(`vynko/google-drive/v1:${secret}`)
    .digest();
}

export interface EncryptedToken {
  encrypted: string;
  iv: string;
  tag: string;
}

export function encryptGoogleToken(plaintext: string): EncryptedToken {
  const masterKey = getMasterKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, masterKey, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  return {
    encrypted,
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
  };
}

export function decryptGoogleToken(payload: EncryptedToken): string {
  const masterKey = getMasterKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, masterKey, Buffer.from(payload.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'hex'));

  let decrypted = decipher.update(payload.encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
