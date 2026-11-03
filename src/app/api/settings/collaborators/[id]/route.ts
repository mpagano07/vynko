import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { deleteCollaborator, updateCollaborator } from '@/lib/collaborator-service';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  const result = await updateCollaborator(auth, id, body as Record<string, unknown>);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.body);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  // `tenant_id` opcional: con él se quita a la persona solo de esa sucursal.
  // Sin él, se la quita de todas las sucursales del owner.
  const tenantId = new URL(request.url).searchParams.get('tenant_id') || undefined;
  const result = await deleteCollaborator(auth, id, tenantId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.body);
}