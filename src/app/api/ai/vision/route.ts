import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { analyzeImage } from '@/lib/ai-service';

export async function POST(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let imageUrl: unknown;
  try {
    const body = await request.json();
    imageUrl = (body as { imageUrl?: unknown } | null)?.imageUrl;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof imageUrl !== 'string' || imageUrl.length === 0) {
    return NextResponse.json({ error: 'URL de imagen requerida' }, { status: 400 });
  }

  const result = await analyzeImage(auth, imageUrl);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status, headers: result.headers }
    );
  }
  return NextResponse.json(result.data);
}
