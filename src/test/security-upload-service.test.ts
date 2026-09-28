import { describe, it, expect, beforeEach, vi } from 'vitest';
import { supabaseMock } from '@/test/supabase-mock';
import {
  ALLOWED_IMAGE_MIMES,
  detectImageMime,
  isAllowedImagePath,
  MAX_UPLOAD_BYTES,
  pathFromLegacyPublicUrl,
  PRODUCT_IMAGE_BUCKET,
  signProductImageUrls,
  uploadImage,
} from '@/lib/upload-service';
import type { AuthInfo } from '@/lib/api-auth';

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: supabaseMock,
}));

const auth: AuthInfo = {
  userId: 'user-1',
  email: 'a@b.com',
  tenantId: '11111111-1111-1111-1111-111111111111',
  allTenantIds: ['11111111-1111-1111-1111-111111111111'],
} as unknown as AuthInfo;

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const GIF89A = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2]);
const GIF87A = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 1, 2]);
const HTML_PAYLOAD = new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e, 0x00]);

// `Request`/`FormData` reales no se pueden construir de forma confiable en el
// entorno jsdom (undici valida el body con su propio File/Blob). Como
// `uploadImage` sólo usa `headers.get('content-length')` y `formData()`, se pasa
// un doble mínimo con la misma forma.
function fakeRequest(
  file: File | null,
  options: { contentLength?: number } = {}
): Request {
  const headers = new Map<string, string>();
  if (options.contentLength !== undefined) {
    headers.set('content-length', String(options.contentLength));
  }
  return {
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
    formData: async () => ({
      get: (key: string) => (key === 'file' ? file : null),
    }),
  } as unknown as Request;
}

function imageFile(bytes: Uint8Array, type: string, sizeOverride?: number): File {
  const file = new File([bytes as unknown as BlobPart], 'imagen.png', { type });
  if (sizeOverride !== undefined) {
    Object.defineProperty(file, 'size', { value: sizeOverride });
  }
  return file;
}

function uploadRequest(bytes: Uint8Array, type: string, fileSize?: number): Request {
  return fakeRequest(imageFile(bytes, type, fileSize));
}

beforeEach(() => {
  supabaseMock.__reset();
  vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(
    '22222222-2222-2222-2222-222222222222' as `${string}-${string}-${string}-${string}-${string}`
  );
});

describe('detectImageMime', () => {
  it('detects png, gif87a and gif89a', () => {
    expect(detectImageMime(PNG_BYTES)).toBe('image/png');
    expect(detectImageMime(GIF89A)).toBe('image/gif');
    expect(detectImageMime(GIF87A)).toBe('image/gif');
  });

  it('rejects non-images and truncated files', () => {
    expect(detectImageMime(HTML_PAYLOAD)).toBeNull();
    expect(detectImageMime(new Uint8Array([0x89, 0x50]))).toBeNull();
  });
});

describe('isAllowedImagePath', () => {
  it('accepts only <tenant>/<uuid>.<ext>', () => {
    expect(isAllowedImagePath(`${auth.tenantId}/22222222-2222-2222-2222-222222222222.png`, auth.tenantId)).toBe(true);
  });

  it('rejects traversal and cross-tenant paths', () => {
    const uuid = '22222222-2222-2222-2222-222222222222.png';
    expect(isAllowedImagePath(`${auth.tenantId}/../${uuid}`, auth.tenantId)).toBe(false);
    expect(isAllowedImagePath(`other-tenant/${uuid}`, auth.tenantId)).toBe(false);
    expect(isAllowedImagePath(`${auth.tenantId}/${uuid}.php`, auth.tenantId)).toBe(false);
    expect(isAllowedImagePath(`${auth.tenantId}`, auth.tenantId)).toBe(false);
  });
});

describe('pathFromLegacyPublicUrl', () => {
  it('extracts the path from the old public URL shape', () => {
    expect(
      pathFromLegacyPublicUrl(
        `https://abc.supabase.co/storage/v1/object/public/${PRODUCT_IMAGE_BUCKET}/${auth.tenantId}/a.png`
      )
    ).toBe(`${auth.tenantId}/a.png`);
  });

  it('returns null for unrelated urls', () => {
    expect(pathFromLegacyPublicUrl('https://cdn.example.com/a.png')).toBeNull();
    expect(pathFromLegacyPublicUrl('')).toBeNull();
  });
});

describe('uploadImage', () => {
  it('uploads with a tenant-scoped uuid path and returns a signed url', async () => {
    const result = await uploadImage(auth, uploadRequest(PNG_BYTES, 'image/png'));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      storagePath: `${auth.tenantId}/22222222-2222-2222-2222-222222222222.png`,
      expiresIn: 3600,
    });

    const uploadCall = supabaseMock.__storageCalls.find((c) => c.method === 'upload');
    expect(supabaseMock.storage.from).toHaveBeenCalledWith(PRODUCT_IMAGE_BUCKET);
    expect(uploadCall?.args[0]).toBe(`${auth.tenantId}/22222222-2222-2222-2222-222222222222.png`);
    expect(uploadCall?.args[2]).toMatchObject({ contentType: 'image/png', upsert: false });
  });

  it('rejects a spoofed mime type', async () => {
    const result = await uploadImage(auth, uploadRequest(HTML_PAYLOAD, 'image/png'));
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it('rejects unsupported mime types', async () => {
    const result = await uploadImage(auth, uploadRequest(PNG_BYTES, 'image/svg+xml'));
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it('rejects empty and oversized files', async () => {
    await expect(uploadImage(auth, uploadRequest(new Uint8Array(0), 'image/png'))).resolves.toMatchObject({
      ok: false,
      status: 400,
    });
    const big = await uploadImage(auth, uploadRequest(PNG_BYTES, 'image/png', MAX_UPLOAD_BYTES + 1));
    expect(big).toMatchObject({ ok: false, status: 413 });
  });

  it('rejects requests without a file part', async () => {
    await expect(uploadImage(auth, fakeRequest(null))).resolves.toMatchObject({
      ok: false,
      status: 400,
    });
  });

  it('rejects a declared content-length above the cap before parsing', async () => {
    const request = fakeRequest(imageFile(PNG_BYTES, 'image/png'), {
      contentLength: MAX_UPLOAD_BYTES + 5 * 1024 * 1024,
    });
    await expect(uploadImage(auth, request)).resolves.toMatchObject({ ok: false, status: 413 });
  });

  it('removes the object when signing fails', async () => {
    supabaseMock.__storageResults.createSignedUrl = { data: null, error: { message: 'boom' } } as never;
    const result = await uploadImage(auth, uploadRequest(PNG_BYTES, 'image/png'));
    expect(result).toMatchObject({ ok: false, status: 500 });
    expect(supabaseMock.__storageCalls.some((c) => c.method === 'remove')).toBe(true);
  });

  it('only advertises the supported mimes', () => {
    expect(ALLOWED_IMAGE_MIMES).toEqual(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
  });
});

describe('signProductImageUrls', () => {
  it('replaces image_url with a signed url per storage path', async () => {
    supabaseMock.__storageResults.createSignedUrls = {
      data: [
        { path: `${auth.tenantId}/a.png`, signedUrl: 'https://signed.test/a.png?token=1' },
        { path: `${auth.tenantId}/b.png`, signedUrl: 'https://signed.test/b.png?token=2' },
      ],
      error: null,
    } as never;

    const result = await signProductImageUrls([
      { id: 1, image_storage_path: `${auth.tenantId}/a.png` },
      { id: 2, image_storage_path: `${auth.tenantId}/b.png` },
      { id: 3 },
    ]);

    expect(result[0].image_url).toBe('https://signed.test/a.png?token=1');
    expect(result[1].image_url).toBe('https://signed.test/b.png?token=2');
    expect(result[2].image_url).toBeUndefined();
  });

  it('signs legacy public urls using the migrated path', async () => {
    supabaseMock.__storageResults.createSignedUrls = {
      data: [{ path: `${auth.tenantId}/legacy.png`, signedUrl: 'https://signed.test/legacy.png' }],
      error: null,
    } as never;

    const result = await signProductImageUrls([
      {
        id: 1,
        image_url: `https://abc.supabase.co/storage/v1/object/public/${PRODUCT_IMAGE_BUCKET}/${auth.tenantId}/legacy.png`,
      },
    ]);

    expect(result[0].image_url).toBe('https://signed.test/legacy.png');
  });

  it('does not call storage when there is nothing to sign', async () => {
    const result = await signProductImageUrls([{ id: 1 }, { id: 2, image_url: 'https://cdn.test/x.png' }]);
    expect(supabaseMock.__storageCalls).toHaveLength(0);
    expect(result).toHaveLength(2);
  });
});
