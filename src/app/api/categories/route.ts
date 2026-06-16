import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';

function getTenantId(request: Request): string | null {
  return request.headers.get('x-tenant-id');
}

export async function GET(request: Request) {
  const tenantId = getTenantId(request);
  if (!tenantId) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 401 });
  }

  const supabaseClient = await createServerSupabaseClient();
  const { data, error } = await supabaseClient
    .from('categories')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('name', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const tenantId = getTenantId(request);
  if (!tenantId) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 401 });
  }

  try {
    const body = await request.json();
    if (!body.name) {
      return NextResponse.json({ error: 'El nombre de la categoría es requerido' }, { status: 400 });
    }

    const category = {
      name: body.name,
      description: body.description || null,
      icon: body.icon || null,
      color: body.color || null,
      tenant_id: tenantId,
    };

    const supabaseClient = await createServerSupabaseClient();
    const { data, error } = await supabaseClient
      .from('categories')
      .insert(category)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(data, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}
