import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { createVariant, listVariants } from '@/lib/variant-service';

export const dynamic = 'force-dynamic';

interface Context {
  params: Promise<{ productId: string }>;
}

export async function GET(request: Request, { params }: Context) {
  const { productId } = await params;
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const result = await listVariants(auth, productId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data);
}

export async function POST(request: Request, { params }: Context) {
  const { productId } = await params;
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const result = await createVariant(auth, productId, body);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data, { status: 201 });
}
