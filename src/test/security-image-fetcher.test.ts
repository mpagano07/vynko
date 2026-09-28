import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ImageFetchError,
  detectImageMimeType,
  fetchImageForAnalysis,
  getAllowedImageHosts,
  isAllowedImageUrl,
  isPrivateAddress,
  MAX_IMAGE_BYTES,
} from '@/lib/security/image-fetcher';

const lookupMock = vi.hoisted(() => vi.fn());

vi.mock('node:dns/promises', () => ({
  default: { lookup: lookupMock },
  lookup: lookupMock,
}));

const lookupSpy = lookupMock;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);

function imageResponse(bytes: Uint8Array, init: ResponseInit = {}): Response {
  return new Response(bytes as unknown as BodyInit, { status: 200, ...init });
}

beforeEach(() => {
  process.env.AI_IMAGE_ALLOWED_HOSTS = 'cdn.example.com';
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  lookupSpy.mockReset();
  lookupSpy.mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
  vi.stubGlobal('fetch', vi.fn(async () => imageResponse(PNG)));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.5',
    '172.16.4.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '198.18.0.1',
    '203.0.113.9',
    '255.255.255.255',
    '::1',
    '::',
    'fe80::1',
    'fd00::1',
    '::ffff:127.0.0.1',
  ])('treats %s as private/blocked', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700::1111'])('allows public %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
});

describe('getAllowedImageHosts', () => {
  it('parses the configured allowlist and adds the Supabase host', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abc.supabase.co';
    const hosts = getAllowedImageHosts();
    expect(hosts.has('cdn.example.com')).toBe(true);
    expect(hosts.has('abc.supabase.co')).toBe(true);
  });
});

describe('isAllowedImageUrl', () => {
  it('supports exact and wildcard entries', () => {
    const allowed = new Set(['cdn.example.com', '*.assets.example.com']);
    expect(isAllowedImageUrl(new URL('https://cdn.example.com/a.png'), allowed)).toBe(true);
    expect(isAllowedImageUrl(new URL('https://x.assets.example.com/a.png'), allowed)).toBe(true);
    expect(isAllowedImageUrl(new URL('https://assets.example.com/a.png'), allowed)).toBe(false);
    expect(isAllowedImageUrl(new URL('https://evil.test/a.png'), allowed)).toBe(false);
  });
});

describe('detectImageMimeType', () => {
  it('detects supported formats', () => {
    expect(detectImageMimeType(PNG)).toBe('image/png');
    expect(detectImageMimeType(JPEG)).toBe('image/jpeg');
    expect(detectImageMimeType(WEBP)).toBe('image/webp');
    expect(detectImageMimeType(GIF)).toBe('image/gif');
  });

  it('rejects non-images and html payloads', () => {
    expect(detectImageMimeType(new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c]))).toBeNull();
    expect(detectImageMimeType(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBeNull();
    expect(detectImageMimeType(new Uint8Array())).toBeNull();
  });
});

describe('fetchImageForAnalysis', () => {
  it('returns base64 for an allowed public image', async () => {
    const result = await fetchImageForAnalysis('https://cdn.example.com/a.png');
    expect(result.mimeType).toBe('image/png');
    expect(result.byteLength).toBe(PNG.length);
    expect(Buffer.from(result.data, 'base64').equals(Buffer.from(PNG))).toBe(true);
  });

  it('rejects non-https, credentials, ip literals and localhost', async () => {
    await expect(fetchImageForAnalysis('http://cdn.example.com/a.png')).rejects.toMatchObject({ status: 400 });
    await expect(fetchImageForAnalysis('https://u:p@cdn.example.com/a.png')).rejects.toMatchObject({ status: 400 });
    await expect(fetchImageForAnalysis('https://127.0.0.1/a.png')).rejects.toMatchObject({ status: 400 });
    await expect(fetchImageForAnalysis('https://localhost/a.png')).rejects.toMatchObject({ status: 400 });
  });

  it('rejects hosts outside the allowlist', async () => {
    await expect(fetchImageForAnalysis('https://evil.test/a.png')).rejects.toBeInstanceOf(ImageFetchError);
  });

  it('rejects hosts resolving to private addresses (SSRF to metadata service)', async () => {
    lookupSpy.mockResolvedValue([{ address: '169.254.169.254', family: 4 }] as never);
    await expect(fetchImageForAnalysis('https://cdn.example.com/a.png')).rejects.toMatchObject({
      status: 400,
    });
  });

  it('rejects when the body exceeds the size cap while streaming', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024));
        controller.enqueue(new Uint8Array(1024 * 1024 + 16));
        controller.close();
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(stream, { status: 200 }))
    );
    await expect(fetchImageForAnalysis('https://cdn.example.com/a.png')).rejects.toMatchObject({
      status: 400,
    });
  });

  it('rejects declared content-length above the cap', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(PNG as unknown as BlobPart, {
            status: 200,
            headers: { 'content-length': String(MAX_IMAGE_BYTES + 1) },
          })
      )
    );
    await expect(fetchImageForAnalysis('https://cdn.example.com/a.png')).rejects.toMatchObject({
      status: 400,
    });
  });

  it('rejects non-image payloads even with an image content-type', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => imageResponse(new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c])))
    );
    await expect(fetchImageForAnalysis('https://cdn.example.com/a.png')).rejects.toMatchObject({
      status: 400,
    });
  });

  it('follows an allowed redirect but re-validates the target', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: 'https://cdn.example.com/real.png' } })
      )
      .mockResolvedValueOnce(imageResponse(PNG));
    vi.stubGlobal('fetch', fetchMock);
    const result = await fetchImageForAnalysis('https://cdn.example.com/a.png');
    expect(result.mimeType).toBe('image/png');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('blocks a redirect to a disallowed host', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } }))
    );
    await expect(fetchImageForAnalysis('https://cdn.example.com/a.png')).rejects.toBeInstanceOf(ImageFetchError);
  });

  it('fails when no allowlist is configured', async () => {
    process.env.AI_IMAGE_ALLOWED_HOSTS = '';
    await expect(fetchImageForAnalysis('https://cdn.example.com/a.png')).rejects.toMatchObject({
      status: 503,
    });
  });
});
