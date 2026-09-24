import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { analyzeImage } from '@/lib/ai-service';

export async function POST(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { imageUrl } = await request.json();

  const result = await analyzeImage(auth, imageUrl);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data);
}