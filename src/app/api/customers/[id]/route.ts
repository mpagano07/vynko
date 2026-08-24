import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  try {
    const body = await request.json();
    const allowed = ['name', 'email', 'phone', 'address', 'notes'];
    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (body[key] !== undefined) updates[key] = body[key];
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No hay campos para actualizar' }, { status: 400 });
    }

    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from('customers')
      .update(updates)
      .eq('id', id)
      .eq('tenant_id', auth.tenantId)
      .select()
      .single();

    if (error) {
      console.error('DB error:', error);
      return NextResponse.json({ error: 'Ocurrio un error inesperado. Intenta de nuevo.' }, { status: 400 });
    }
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { error } = await supabaseAdmin
    .from('customers')
    .delete()
    .eq('id', id)
    .eq('tenant_id', auth.tenantId);

  if (error) {
    console.error('DB error:', error);
    return NextResponse.json({ error: 'Ocurrio un error inesperado. Intenta de nuevo.' }, { status: 400 });
  }
  return NextResponse.json({ success: true });
}
