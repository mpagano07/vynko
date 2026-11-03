import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import {
  deleteCollaborator,
  setCollaboratorActive,
  updateCollaborator,
} from '@/lib/collaborator-service';

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

  const payload = body as Record<string, unknown>;

  // Desactivar/reactivar es una operación distinta de editar roles: conserva la
  // fila y el historial. Se separa por `status` para no mezclarla con el
  // payload de `memberships`.
  if (payload.status === 'active' || payload.status === 'inactive') {
    const tenantId = typeof payload.tenant_id === 'string' ? payload.tenant_id : undefined;
    const result = await setCollaboratorActive(auth, id, payload.status === 'active', tenantId);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.body);
  }

  const result = await updateCollaborator(auth, id, payload);
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
