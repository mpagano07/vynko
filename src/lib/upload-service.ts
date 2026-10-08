import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { rateLimit } from '@/lib/rate-limit';
import type { AuthInfo } from '@/lib/api-auth';
import { logger } from '@/lib/logger';

export const PRODUCT_IMAGE_BUCKET = 'product-images';
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const SIGNED_URL_TTL_SECONDS = 60 * 60;

export type UploadResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; status: number; headers?: Record<string, string> };

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export const ALLOWED_IMAGE_MIMES = Object.keys(EXT_BY_MIME);

export function isAllowedImagePath(path: string, tenantId: string): boolean {
  const safeTenant = tenantId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${safeTenant}/[0-9a-f-]{36}\\.(jpg|png|webp|gif)$`).test(path);
}

export function pathFromLegacyPublicUrl(url: string): string | null {
  const marker = `/object/public/${PRODUCT_IMAGE_BUCKET}/`;
  const index = url.indexOf(marker);
  if (index === -1) return null;
  const path = url.slice(index + marker.length);
  return path.length > 0 ? path : null;
}

export function detectImageMime(bytes: Uint8Array): string | null {
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
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61
  ) {
    return 'image/gif';
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

function isFileLike(value: unknown): value is File {
  if (typeof value === 'string' || value === null || typeof value !== 'object') return false;
  const candidate = value as Partial<File>;
  return (
    typeof candidate.arrayBuffer === 'function' &&
    typeof candidate.size === 'number' &&
    typeof candidate.type === 'string'
  );
}

async function rateLimitFailure(key: string, limit: number, windowMs: number) {
  const result = await rateLimit(key, limit, windowMs);
  if (result.ok) return null;
  return {
    ok: false as const,
    error: 'Límite de subidas alcanzado. Probá de nuevo más tarde.',
    status: 429,
    headers: { 'Retry-After': String(result.retryAfterSeconds) },
  };
}

export async function uploadImage(auth: AuthInfo, request: Request): Promise<UploadResult> {
  const tenantId = auth.tenantId;

  // Igual que en el limite de IA: se consultan los dos contadores y se devuelve
  // el primer fallo. Cortar en el primero dejaria sin decrementar el limite por
  // usuario, que es el que frena a alguien repartiendo subidas entre cuentas.
  const tenantLimit = await rateLimitFailure(`upload:tenant:${tenantId}`, 30, 60 * 60 * 1000);
  const userLimit = await rateLimitFailure(`upload:user:${auth.userId}`, 10, 60 * 60 * 1000);
  if (tenantLimit) return tenantLimit;
  if (userLimit) return userLimit;

  // El body se parsea entero con request.formData(): el Content-Length permite
  // rechazar antes de bufferizar un multipart gigante.
  const declaredLength = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_BYTES + 1024 * 1024) {
    return { ok: false, error: 'La imagen no debe superar los 5MB.', status: 413 };
  }

  let file: File;
  try {
    const formData = await request.formData();
    const raw: unknown = formData.get('file');
    // Duck-typing en vez de `instanceof File`: el `File` que devuelve
    // `request.formData()` puede venir de otro realm (undici vs. polyfill), y en
    // ese caso `instanceof` da false para un upload perfectamente válido. Los
    // chequeos reales (tamaño, MIME y magic bytes) se hacen igual más abajo.
    if (!isFileLike(raw)) throw new Error('missing file');
    file = raw;
  } catch {
    return { ok: false, error: 'No file provided', status: 400 };
  }

  if (file.size === 0) {
    return { ok: false, error: 'El archivo está vacío.', status: 400 };
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: 'La imagen no debe superar los 5MB.', status: 413 };
  }

  if (!file.type || !EXT_BY_MIME[file.type]) {
    return { ok: false, error: 'El archivo no es una imagen válida. Usá JPG, PNG, WebP o GIF.', status: 400 };
  }

  const buffer = new Uint8Array(await file.arrayBuffer());
  const mime = detectImageMime(buffer);
  if (!mime || !EXT_BY_MIME[mime]) {
    return { ok: false, error: 'El archivo no es una imagen válida. Usá JPG, PNG, WebP o GIF.', status: 400 };
  }

  if (mime !== file.type) {
    return { ok: false, error: 'El contenido del archivo no coincide con su tipo.', status: 400 };
  }

  const storagePath = `${tenantId}/${crypto.randomUUID()}.${EXT_BY_MIME[mime]}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .upload(storagePath, buffer, {
      contentType: mime,
      cacheControl: '3600',
      upsert: false,
    });

  if (uploadError) {
    logger.error('Upload error:', { error: uploadError.message });
    return { ok: false, error: 'No se pudo subir la imagen. Intentá de nuevo.', status: 500 };
  }

  const { data: signed, error: signedError } = await supabaseAdmin.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);

  if (signedError || !signed?.signedUrl) {
    await supabaseAdmin.storage.from(PRODUCT_IMAGE_BUCKET).remove([storagePath]);
    return { ok: false, error: 'No se pudo subir la imagen. Intentá de nuevo.', status: 500 };
  }

  return {
    ok: true,
    data: { storagePath, url: signed.signedUrl, expiresIn: SIGNED_URL_TTL_SECONDS },
  };
}

export async function signProductImageUrls(
  products: Array<Record<string, unknown>>,
  tenantId: string
): Promise<Array<Record<string, unknown>>> {
  const ownPath = (product: Record<string, unknown>): string | null => {
    const storagePath =
      typeof product.image_storage_path === 'string' && product.image_storage_path
        ? product.image_storage_path
        : typeof product.image_url === 'string'
          ? pathFromLegacyPublicUrl(product.image_url)
          : null;
    if (!storagePath) return null;
    // El bucket se firma con la service role, asi que un path sin scope
    // devolveria una URL valida de otra empresa. Solo se firma lo que vive
    // bajo el folder del tenant activo.
    return isAllowedImagePath(storagePath, tenantId) ? storagePath : null;
  };

  const paths = products.map(ownPath).filter((path): path is string => !!path);

  if (paths.length === 0) return products;

  const uniquePaths = [...new Set(paths)];
  const { data } = await supabaseAdmin.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .createSignedUrls(uniquePaths, SIGNED_URL_TTL_SECONDS);

  const urlByPath = new Map<string, string>();
  for (const entry of data ?? []) {
    if (entry.path && entry.signedUrl) urlByPath.set(entry.path, entry.signedUrl);
  }

  return products.map((product) => {
    const storagePath = ownPath(product);
    const signedUrl = storagePath ? urlByPath.get(storagePath) : undefined;
    if (!signedUrl) return product;
    return { ...product, image_url: signedUrl };
  });
}
