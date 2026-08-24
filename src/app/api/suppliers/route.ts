import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { createActivityLog } from '@/lib/activity-log';

export async function GET(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let query = supabaseAdmin
    .from('suppliers')
    .select('*')
    .order('name', { ascending: true });
  if (!auth.allTenants) query = query.eq('tenant_id', auth.tenantId);

  const { data, error } = await query;

  if (error) { console.error('DB error:', error); return NextResponse.json({ error: 'Ocurrio un error inesperado. Intenta de nuevo.' }, { status: 500 }); }
  return NextResponse.json(data || []);
}

export async function POST(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  try {
    const body = await request.json();
    if (!body.name) {
      return NextResponse.json({ error: 'El nombre del proveedor es requerido' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('suppliers')
      .insert({
        tenant_id: auth.tenantId,
        name: body.name,
        contact_name: body.contact_name || null,
        email: body.email || null,
        phone: body.phone || null,
        address: body.address || null,
        notes: body.notes || null,
      })
      .select()
      .single();

    if (error) { console.error('DB error:', error); return NextResponse.json({ error: 'Ocurrio un error inesperado. Intenta de nuevo.' }, { status: 400 }); }

    await supabaseAdmin
      .from('providers')
      .insert({
        id: data.id,
        tenant_id: auth.tenantId,
        name: body.name,
        email: body.email || null,
        phone: body.phone || null,
        address: body.address || null,
      })
      .select()
      .single();

    await createActivityLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: 'created',
      entityType: 'supplier',
      entityId: data.id,
      details: { name: body.name },
    });

    return NextResponse.json(data, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}
