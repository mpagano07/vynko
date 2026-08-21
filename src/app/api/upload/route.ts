import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { rateLimit } from '@/lib/rate-limit';

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

  const formData = await request.formData();
  const file = formData.get('file') as File;
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowedTypes.includes(file.type)) {
    return NextResponse.json({ error: 'Formato no válido. Usá JPG, PNG, WebP o GIF.' }, { status: 400 });
  }

  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: 'La imagen no debe superar los 5MB.' }, { status: 400 });
  }

  const buffer = await file.arrayBuffer();
  const ext = file.name.split('.').pop() || 'jpg';
  const fileName = `${tenantId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from('product-images')
    .upload(fileName, buffer, { contentType: file.type, cacheControl: '3600' });

  if (uploadError) {
    if (uploadError.message?.includes('bucket')) {
      await supabaseAdmin.storage.createBucket('product-images', {
        public: true, fileSizeLimit: 5242880,
      });
      const { error: retryError } = await supabaseAdmin.storage
        .from('product-images')
        .upload(fileName, buffer, { contentType: file.type, cacheControl: '3600' });
      if (retryError) return NextResponse.json({ error: retryError.message }, { status: 500 });
    } else {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }
  }

  const { data: { publicUrl } } = supabaseAdmin.storage
    .from('product-images')
    .getPublicUrl(fileName);

  return NextResponse.json({ url: publicUrl });
}
