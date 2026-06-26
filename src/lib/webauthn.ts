export interface StoredCredential {
  credentialId: string;
  publicKeySpki: string;
  deviceName: string;
  createdAt: number;
}

const CREDENTIAL_KEY = 'stockpilot_biometric';
const REFRESH_KEY = 'stockpilot_biometric_refresh';

export function isWebAuthnSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    'credentials' in navigator &&
    'PublicKeyCredential' in window
  );
}

export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!isWebAuthnSupported()) return false;
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

function toBase64Url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str: string): ArrayBuffer {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const binary = atob(s);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function p1363ToDer(sig: Uint8Array): ArrayBuffer {
  const half = sig.length / 2;
  const r = sig.slice(0, half);
  const s = sig.slice(half);

  const encInteger = (n: Uint8Array): Uint8Array => {
    let start = 0;
    while (start < n.length && n[start] === 0) start++;
    const trimmed = n.slice(start);
    if (trimmed[0] & 0x80) {
      const out = new Uint8Array(2 + trimmed.length + 1);
      out[0] = 0x02;
      out[1] = trimmed.length + 1;
      out[2] = 0x00;
      out.set(trimmed, 3);
      return out;
    }
    const out = new Uint8Array(2 + trimmed.length);
    out[0] = 0x02;
    out[1] = trimmed.length;
    out.set(trimmed, 2);
    return out;
  };

  const rDer = encInteger(r);
  const sDer = encInteger(s);
  const seq = new Uint8Array(2 + rDer.length + sDer.length);
  seq[0] = 0x30;
  seq[1] = rDer.length + sDer.length;
  seq.set(rDer, 2);
  seq.set(sDer, 2 + rDer.length);
  return seq.buffer;
}

export async function registerBiometric(
  userId: string,
  userName: string,
  userDisplayName: string,
): Promise<void> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const credential = (await navigator.credentials.create({
    publicKey: {
      rp: { id: window.location.hostname, name: 'StockPilot' },
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

  const response = credential.response as AuthenticatorAttestationResponse;

  if (typeof response.getPublicKey !== 'function') {
    throw new Error('getPublicKey() no soportado en este navegador');
  }

  const pubKey = response.getPublicKey() as unknown as CryptoKey;
  const spki = await crypto.subtle.exportKey('spki', pubKey);

  const stored: StoredCredential = {
    credentialId: credential.id,
    publicKeySpki: toBase64Url(spki),
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

  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge,
      allowCredentials: [
        { id: credentialId, type: 'public-key' },
      ],
      userVerification: 'required',
      timeout: 60000,
    },
  })) as PublicKeyCredential;

  const response = assertion.response as AuthenticatorAssertionResponse;

  const authData = new Uint8Array(response.authenticatorData);
  const clientDataJSON = new Uint8Array(response.clientDataJSON);
  const signature = new Uint8Array(response.signature);

  const clientDataHash = await crypto.subtle.digest('SHA-256', clientDataJSON);

  const signedData = new Uint8Array(authData.length + clientDataHash.byteLength);
  signedData.set(authData);
  signedData.set(new Uint8Array(clientDataHash), authData.length);

  const spki = fromBase64Url(stored.publicKeySpki);
  const publicKey = await crypto.subtle.importKey(
    'spki',
    spki,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );

  const derSig = p1363ToDer(signature);

  return crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publicKey,
    derSig,
    signedData,
  );
}
