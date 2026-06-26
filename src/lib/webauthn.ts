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

function readCBORInteger(data: Uint8Array, offset: { value: number }): number {
  const byte = data[offset.value];
  const major = byte >> 5;
  const info = byte & 0x1f;
  offset.value++;

  let value: number;
  if (info < 24) {
    value = info;
  } else if (info === 24) {
    value = data[offset.value];
    offset.value++;
  } else if (info === 25) {
    value = (data[offset.value] << 8) | data[offset.value + 1];
    offset.value += 2;
  } else {
    throw new Error('CBOR integer too large');
  }

  if (major === 0) return value;
  if (major === 1) return -1 - value;
  throw new Error('Expected integer');
}

function readCBORByteString(data: Uint8Array, offset: { value: number }): Uint8Array {
  const byte = data[offset.value];
  const major = byte >> 5;
  const info = byte & 0x1f;
  offset.value++;

  if (major !== 2) throw new Error('Expected byte string');

  let len: number;
  if (info < 24) {
    len = info;
  } else if (info === 24) {
    len = data[offset.value];
    offset.value++;
  } else if (info === 25) {
    len = (data[offset.value] << 8) | data[offset.value + 1];
    offset.value += 2;
  } else {
    throw new Error('Byte string length too large');
  }

  const result = data.slice(offset.value, offset.value + len);
  offset.value += len;
  return result;
}

function skipCBORValue(data: Uint8Array, offset: { value: number }): void {
  const byte = data[offset.value];
  const major = byte >> 5;
  const info = byte & 0x1f;

  switch (major) {
    case 0: // unsigned int
    case 1: // negative int
      offset.value++;
      if (info >= 24 && info <= 27) offset.value += 1 << (info - 24);
      break;
    case 2: // byte string
    case 3: // text string
      offset.value++;
      if (info < 24) offset.value += info;
      else if (info === 24) { offset.value += 1 + data[offset.value]; }
      else if (info === 25) { const l = (data[offset.value] << 8) | data[offset.value + 1]; offset.value += 2 + l; }
      else if (info === 26) { const l = (data[offset.value] << 24) | (data[offset.value + 1] << 16) | (data[offset.value + 2] << 8) | data[offset.value + 3]; offset.value += 4 + l; }
      else throw new Error('Unexpected info');
      break;
    case 4: // array
      offset.value++;
      { let count = info; if (info === 24) count = data[offset.value++]; else if (info === 25) { count = (data[offset.value] << 8) | data[offset.value + 1]; offset.value += 2; } else if (info === 26) { count = (data[offset.value] << 24) | (data[offset.value + 1] << 16) | (data[offset.value + 2] << 8) | data[offset.value + 3]; offset.value += 4; }
      for (let i = 0; i < count; i++) skipCBORValue(data, offset); }
      break;
    case 5: // map
      offset.value++;
      { let count = info; if (info === 24) count = data[offset.value++]; else if (info === 25) { count = (data[offset.value] << 8) | data[offset.value + 1]; offset.value += 2; } else if (info === 26) { count = (data[offset.value] << 24) | (data[offset.value + 1] << 16) | (data[offset.value + 2] << 8) | data[offset.value + 3]; offset.value += 4; }
      for (let i = 0; i < count * 2; i++) skipCBORValue(data, offset); }
      break;
    default:
      throw new Error(`Unexpected CBOR major type ${major}`);
  }
}

function parseCOSEFromAuthData(authData: Uint8Array): { x: Uint8Array; y: Uint8Array } {
  const AT_FLAG = 0x40;
  const flags = authData[32];

  if (!(flags & AT_FLAG)) {
    throw new Error('No attested credential data in authData');
  }

  let offset = 37; // 32 (rpIdHash) + 1 (flags) + 4 (signCount)

  // Skip AAGUID (16 bytes)
  offset += 16;

  // Read credential ID length (2 bytes, big endian)
  const credIdLen = (authData[offset] << 8) | authData[offset + 1];
  offset += 2;

  // Skip credential ID
  offset += credIdLen;

  // Now at the COSE key. Parse CBOR map.
  const coseStart = offset;
  const firstByte = authData[offset];
  if ((firstByte >> 5) !== 5) throw new Error('Expected CBOR map for COSE key');

  const mapInfo = firstByte & 0x1f;
  offset++;
  let mapEntries: number;
  if (mapInfo < 24) mapEntries = mapInfo;
  else if (mapInfo === 24) { mapEntries = authData[offset]; offset++; }
  else throw new Error('COSE map too large');

  let x: Uint8Array | null = null;
  let y: Uint8Array | null = null;

  for (let i = 0; i < mapEntries; i++) {
    const key = readCBORInteger(authData, { value: offset });

    if (key === -2) {
      x = readCBORByteString(authData, { value: offset });
    } else if (key === -3) {
      y = readCBORByteString(authData, { value: offset });
    } else {
      skipCBORValue(authData, { value: offset });
    }
  }

  if (!x || !y) throw new Error('Could not find x/y coordinates in COSE key');

  return { x, y };
}

async function coseToSpki(authData: Uint8Array): Promise<ArrayBuffer> {
  const { x, y } = parseCOSEFromAuthData(authData);

  // Build uncompressed EC point: 0x04 || x || y
  const rawPoint = new Uint8Array(1 + 32 + 32);
  rawPoint[0] = 0x04;
  rawPoint.set(x, 1);
  rawPoint.set(y, 33);

  const pubKey = await crypto.subtle.importKey(
    'raw',
    rawPoint,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['verify'],
  );

  return crypto.subtle.exportKey('spki', pubKey);
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
  const authData = new Uint8Array(response.getAuthenticatorData());
  const spki = await coseToSpki(authData);

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
