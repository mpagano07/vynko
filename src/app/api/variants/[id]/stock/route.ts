import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { adjustVariantStock } from '@/lib/variant-service';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const result = await adjustVariantStock(
    auth,
    id,
    Number(body.quantity),
    String(body.reason ?? ''),
    body.notes == null ? undefined : String(body.notes)
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data);
}
