import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { addCollaborator, listCollaborators } from '@/lib/collaborator-service';
import { fixResponse } from '@/lib/utils/encoding';

export async function GET(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const result = await listCollaborators(auth);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(fixResponse(result.body));
}

export async function POST(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  const origin = new URL(request.url).origin;
  const result = await addCollaborator(auth, body as Record<string, unknown>, origin);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.body, { status: result.status });
}