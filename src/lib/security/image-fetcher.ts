import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 2;
const MAX_URL_LENGTH = 2048;

export type FetchedImage = {
  data: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  byteLength: number;
};

export class ImageFetchError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ImageFetchError';
  }
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0) return true;
  if (a === 198 && (b === 18 || b === 19 || b === 51 || b === 52)) return true;
  if (a === 203 && b === 0) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fe80') || normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (normalized.startsWith('ff')) return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped && isPrivateIPv4(mapped[1])) return true;
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPrivateIPv4(ip);
  if (version === 6) return isPrivateIPv6(ip);
  return true;
}

function parseUrl(rawUrl: string): URL {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) {
    throw new ImageFetchError(400, 'URL de imagen requerida');
  }
  if (rawUrl.length > MAX_URL_LENGTH) {
    throw new ImageFetchError(400, 'URL de imagen demasiado larga');
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ImageFetchError(400, 'URL de imagen inválida');
  }

  if (url.protocol !== 'https:') {
    throw new ImageFetchError(400, 'La URL de imagen debe usar HTTPS');
  }
  if (url.username || url.password) {
    throw new ImageFetchError(400, 'La URL de imagen no puede incluir credenciales');
  }
  if (url.port && url.port !== '443') {
    throw new ImageFetchError(400, 'La URL de imagen debe usar el puerto 443');
  }
  if (isIP(url.hostname) !== 0) {
    throw new ImageFetchError(400, 'La URL de imagen no puede usar direcciones IP');
  }
  if (url.hostname === 'localhost' || url.hostname.endsWith('.localhost') || url.hostname.endsWith('.local')) {
    throw new ImageFetchError(400, 'Host de imagen no permitido');
  }

  return url;
}

export function getAllowedImageHosts(): Set<string> {
  const configured = (process.env.AI_IMAGE_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);

  const supabaseHost = (() => {
    try {
      return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').hostname.toLowerCase();
    } catch {
      return '';
    }
  })();

  const hosts = new Set<string>(configured);
  if (supabaseHost) hosts.add(supabaseHost);
  return hosts;
}

export function isAllowedImageUrl(url: URL, allowedHosts: Set<string>): boolean {
  const hostname = url.hostname.toLowerCase();
  if (allowedHosts.has(hostname)) return true;
  for (const host of allowedHosts) {
    if (host.startsWith('*.') && hostname.endsWith(host.slice(1)) && hostname !== host.slice(2)) {
      return true;
    }
  }
  return false;
}

async function assertPublicHost(hostname: string): Promise<void> {
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new ImageFetchError(400, 'No se pudo resolver el host de la imagen');
  }
  if (addresses.length === 0) {
    throw new ImageFetchError(400, 'El host de la imagen no resuelve direcciones');
  }
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new ImageFetchError(400, 'El host de la imagen resuelve a una dirección privada');
    }
  }
}

export function detectImageMimeType(bytes: Uint8Array): FetchedImage['mimeType'] | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    if (bytes.length >= 6 && (bytes[4] === 0x38 || bytes[4] === 0x39) && bytes[5] === 0x61) {
      return 'image/gif';
    }
  }
  if (
    bytes.length >= 16 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50 &&
    (bytes[12] === 0x56 || bytes[12] === 0x4c || bytes[12] === 0x58)
  ) {
    return 'image/webp';
  }
  return null;
}

async function readCappedBody(response: Response, limit: number): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    throw new ImageFetchError(400, 'La imagen supera el tamaño máximo permitido');
  }

  const body = response.body;
  if (!body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > limit) {
      throw new ImageFetchError(400, 'La imagen supera el tamaño máximo permitido');
    }
    return buffer;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        throw new ImageFetchError(400, 'La imagen supera el tamaño máximo permitido');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

export async function fetchImageForAnalysis(rawUrl: string): Promise<FetchedImage> {
  const allowedHosts = getAllowedImageHosts();
  if (allowedHosts.size === 0) {
    throw new ImageFetchError(503, 'No hay hosts de imagen configurados');
  }

  let currentUrl = parseUrl(rawUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      if (!isAllowedImageUrl(currentUrl, allowedHosts)) {
        throw new ImageFetchError(400, 'Host de imagen no permitido');
      }
      await assertPublicHost(currentUrl.hostname);

      const response = await fetch(currentUrl.toString(), {
        redirect: 'manual',
        signal: controller.signal,
        cache: 'no-store',
        headers: { accept: 'image/*' },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location || hop === MAX_REDIRECTS) {
          throw new ImageFetchError(400, 'La imagen redirige a una ubicación no válida');
        }
        currentUrl = parseUrl(new URL(location, currentUrl).toString());
        continue;
      }

      if (!response.ok) {
        throw new ImageFetchError(400, 'No se pudo descargar la imagen');
      }

      const bytes = await readCappedBody(response, MAX_IMAGE_BYTES);
      if (bytes.byteLength === 0) {
        throw new ImageFetchError(400, 'La imagen está vacía');
      }
      const mimeType = detectImageMimeType(bytes);
      if (!mimeType) {
        throw new ImageFetchError(400, 'El archivo no es una imagen válida. Usá JPG, PNG, WebP o GIF.');
      }

      return {
        data: Buffer.from(bytes).toString('base64'),
        mimeType,
        byteLength: bytes.byteLength,
      };
    }

    throw new ImageFetchError(400, 'Demasiadas redirecciones');
  } catch (error) {
    if (error instanceof ImageFetchError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ImageFetchError(400, 'La descarga de la imagen excedió el tiempo límite');
    }
    throw new ImageFetchError(400, 'No se pudo descargar la imagen');
  } finally {
    clearTimeout(timer);
  }
}
