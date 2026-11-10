import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { rateLimit } from '@/lib/rate-limit';
import type { AuthInfo } from '@/lib/api-auth';
import { logger } from '@/lib/logger';

export const PRODUCT_IMAGE_BUCKET = 'product-images';
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const SIGNED_URL_TTL_SECONDS = 60 * 60;

/**
 * Limites de dimension de una imagen de producto.
 *
 * El limite de 5MB no evita una bomba de descompresion: un PNG de pocos KB puede
 * declarar 30000x30000 pixeles y hacer que el navegador (o cualquier consumidor
 * del archivo) reserve gigabytes al decodificarlo. Se valida el header, que es
 * barato, antes de aceptar el archivo.
 */
export const MAX_IMAGE_DIMENSION = 4096;
const MAX_IMAGE_PIXELS = 16_000_000;

export interface ImageDimensions {
  width: number;
  height: number;
}

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

function readUInt16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUInt32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>>
    0
  );
}

/** Marcadores JPEG que contienen las dimensiones (SOF). Se excluyen DHT/JPG/DAC. */
function isJpegSofMarker(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

function readJpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  let offset = 2; // despues del SOI (FF D8)
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    // Bytes de relleno entre segmentos.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // Marcadores sin longitud: SOI, EOI, RSTn y TEM.
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (offset + 4 > bytes.length) return null;
    const length = readUInt16BE(bytes, offset + 2);
    if (length < 2) return null;
    if (isJpegSofMarker(marker)) {
      if (offset + 9 > bytes.length) return null;
      return {
        height: readUInt16BE(bytes, offset + 5),
        width: readUInt16BE(bytes, offset + 7),
      };
    }
    offset += 2 + length;
  }
  return null;
}

function readWebpDimensions(bytes: Uint8Array): ImageDimensions | null {
  const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);

  if (chunk === 'VP8X') {
    if (bytes.length < 30) return null;
    return {
      width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)),
      height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)),
    };
  }

  if (chunk === 'VP8L') {
    if (bytes.length < 25 || bytes[20] !== 0x2f) return null;
    const bits =
      (bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24)) >>> 0;
    return {
      width: 1 + (bits & 0x3fff),
      height: 1 + ((bits >>> 14) & 0x3fff),
    };
  }

  if (chunk === 'VP8 ') {
    if (bytes.length < 30) return null;
    // Start code 9d 01 2a antes de las dimensiones.
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    return {
      width: (bytes[26] | (bytes[27] << 8)) & 0x3fff,
      height: (bytes[28] | (bytes[29] << 8)) & 0x3fff,
    };
  }

  return null;
}

/**
 * Lee ancho/alto del header del archivo, sin decodificar la imagen.
 *
 * Devuelve `null` si el formato es valido pero el header no alcanza para leer
 * las dimensiones; el llamador trata ese caso como archivo invalido, porque sin
 * dimensiones no se puede descartar una bomba de descompresion.
 */
export function readImageDimensions(
  bytes: Uint8Array,
  mime: string
): ImageDimensions | null {
  if (mime === 'image/png') {
    if (bytes.length < 24) return null;
    if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) {
      return null; // falta el chunk IHDR
    }
    return { width: readUInt32BE(bytes, 16), height: readUInt32BE(bytes, 20) };
  }

  if (mime === 'image/gif') {
    if (bytes.length < 10) return null;
    return {
      width: bytes[6] | (bytes[7] << 8),
      height: bytes[8] | (bytes[9] << 8),
    };
  }

  if (mime === 'image/jpeg') {
    return readJpegDimensions(bytes);
  }

  if (mime === 'image/webp') {
    return readWebpDimensions(bytes);
  }

  return null;
}

function exceedsDimensionLimits({ width, height }: ImageDimensions): boolean {
  return (
    width <= 0 ||
    height <= 0 ||
    width > MAX_IMAGE_DIMENSION ||
    height > MAX_IMAGE_DIMENSION ||
    width * height > MAX_IMAGE_PIXELS
  );
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

  // Se consultan los dos contadores y se devuelve
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

  // El tamano en bytes no alcanza: un PNG de pocos KB puede declarar miles de
  // millones de pixeles y reventar al decodificarse. Se leen las dimensiones del
  // header (sin decodificar) y se rechaza antes de guardar el objeto.
  const dimensions = readImageDimensions(buffer, mime);
  if (!dimensions) {
    return {
      ok: false,
      error: 'No se pudieron leer las dimensiones de la imagen. Usá JPG, PNG, WebP o GIF válidos.',
      status: 400,
    };
  }
  if (exceedsDimensionLimits(dimensions)) {
    return {
      ok: false,
      error: `La imagen supera el tamaño máximo permitido (${MAX_IMAGE_DIMENSION}px por lado).`,
      status: 400,
    };
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

/**
 * Borra todas las imágenes de producto de una empresa antes de eliminar la
 * cuenta. Las filas de `products` se van por cascada, pero los objetos del
 * bucket no: sin esto quedaban archivos huérfanos, accesibles por service role
 * y sin dueño en la base.
 */
export async function deleteTenantProductImages(
  tenantId: string
): Promise<{ ok: true; deleted: number } | { ok: false; error: string }> {
  const paths: string[] = [];
  const limit = 1000;
  let offset = 0;

  while (true) {
    const { data, error } = await supabaseAdmin.storage
      .from(PRODUCT_IMAGE_BUCKET)
      .list(tenantId, { limit, offset });

    if (error) {
      logger.error('Error listing product images for deletion:', {
        error,
        tenantId,
      });
      return { ok: false, error: 'No se pudieron eliminar las imágenes de tus productos.' };
    }

    const entries = data ?? [];
    for (const entry of entries) {
      // Las carpetas virtuales no tienen `id`; nuestros uploads siempre viven
      // planos en `tenantId/uuid.ext`, así que no hay nada que borrar ahí.
      if (!entry.id) continue;
      paths.push(`${tenantId}/${entry.name}`);
    }

    if (entries.length < limit) break;
    offset += limit;
  }

  const uniquePaths = [...new Set(paths)];
  const chunkSize = 100;

  for (let index = 0; index < uniquePaths.length; index += chunkSize) {
    const chunk = uniquePaths.slice(index, index + chunkSize);
    const { error } = await supabaseAdmin.storage
      .from(PRODUCT_IMAGE_BUCKET)
      .remove(chunk);

    if (error) {
      logger.error('Error removing product images for deletion:', {
        error,
        tenantId,
      });
      return { ok: false, error: 'No se pudieron eliminar las imágenes de tus productos.' };
    }
  }

  return { ok: true, deleted: uniquePaths.length };
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
