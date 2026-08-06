export interface StoredCredential {
  credentialId: string;
  deviceName: string;
  createdAt: number;
}

const CREDENTIAL_KEY = 'vynko_biometric';
const REFRESH_KEY = 'vynko_biometric_refresh';

export function isWebAuthnSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    'credentials' in navigator &&
    'PublicKeyCredential' in window
  );
}

export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /android|iphone|ipad|ipod|webos/i.test(navigator.userAgent);
}

export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!isWebAuthnSupported() || !isMobileDevice()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export function getStoredCredential(): StoredCredential | null {
  try {
    const raw = localStorage.getItem(CREDENTIAL_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearStoredCredential(): void {
  localStorage.removeItem(CREDENTIAL_KEY);
}

export function getStoredRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

export function clearStoredRefreshToken(): void {
  localStorage.removeItem(REFRESH_KEY);
}

export function storeRefreshToken(token: string): void {
  localStorage.setItem(REFRESH_KEY, token);
}

function fromBase64Url(str: string): ArrayBuffer {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const binary = atob(s);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export async function registerBiometric(
  userId: string,
  userName: string,
  userDisplayName: string,
): Promise<void> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const credential = (await navigator.credentials.create({
    publicKey: {
      rp: { id: window.location.hostname, name: 'Vynko' },
      user: {
        id: new TextEncoder().encode(userId),
        name: userName,
        displayName: userDisplayName,
      },
      challenge,
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'discouraged',
      },
      timeout: 60000,
    },
  })) as PublicKeyCredential;

  const stored: StoredCredential = {
    credentialId: credential.id,
    deviceName: navigator.userAgent,
    createdAt: Date.now(),
  };

  localStorage.setItem(CREDENTIAL_KEY, JSON.stringify(stored));
}

export async function authenticateBiometric(): Promise<boolean> {
  const stored = getStoredCredential();
  if (!stored) throw new Error('No hay credencial biométrica guardada');

  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const credentialId = fromBase64Url(stored.credentialId);

  await navigator.credentials.get({
    publicKey: {
      challenge,
      allowCredentials: [
        { id: credentialId, type: 'public-key' },
      ],
      userVerification: 'required',
      timeout: 60000,
    },
  });

  return true;
}
