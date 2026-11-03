import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { transferOwnership } from '@/lib/collaborator-service';

/**
 * Transfiere la propiedad de una sucursal al colaborador `id`.
 *
 * La transacción real vive en la función SQL `transfer_tenant_ownership`
 * (migración 066), que promueve al nuevo owner antes de degradar al anterior.
 * El endpoint sólo resuelve identidad, alcance y traducción de errores.
 */
export async function POST(
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
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const tenantId =
    body && typeof body === 'object' && typeof (body as { tenant_id?: unknown }).tenant_id === 'string'
      ? ((body as { tenant_id: string }).tenant_id)
      : null;

  const result = await transferOwnership(auth, tenantId, id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.body);
}
