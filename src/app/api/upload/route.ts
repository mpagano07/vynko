import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { rateLimit } from '@/lib/rate-limit';

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

function detectImageMime(bytes: Uint8Array): string | null {
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
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return 'image/gif';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

export async function POST(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const tenantId = auth.tenantId;

  const limit = rateLimit(`upload:${tenantId}`, 30, 60 * 60 * 1000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Límite de subidas alcanzado. Probá de nuevo más tarde.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    );
  }

  let file: File;
  try {
    const formData = await request.formData();
    const raw = formData.get('file');
    if (!(raw instanceof File)) throw new Error();
    file = raw;
  } catch {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }

  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: 'La imagen no debe superar los 5MB.' }, { status: 400 });
  }

  const buffer = new Uint8Array(await file.arrayBuffer());
  const mime = detectImageMime(buffer);
  if (!mime || !EXT_BY_MIME[mime]) {
    return NextResponse.json(
      { error: 'El archivo no es una imagen válida. Usá JPG, PNG, WebP o GIF.' },
      { status: 400 }
    );
  }

  const fileName = `${tenantId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${EXT_BY_MIME[mime]}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from('product-images')
    .upload(fileName, buffer, { contentType: mime, cacheControl: '3600' });

  if (uploadError) {
    console.error('Upload error:', uploadError.message);
    return NextResponse.json(
      { error: 'No se pudo subir la imagen. Intentá de nuevo.' },
      { status: 500 }
    );
  }

  const { data: { publicUrl } } = supabaseAdmin.storage
    .from('product-images')
    .getPublicUrl(fileName);

  return NextResponse.json({ url: publicUrl });
}
