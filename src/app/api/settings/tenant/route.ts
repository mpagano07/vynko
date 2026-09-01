import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function PATCH(request: Request) {
  try {
    const auth = await getAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { data: tu } = await supabaseAdmin
      .from('tenant_users')
      .select('role')
      .eq('user_id', auth.userId)
      .eq('tenant_id', auth.tenantId);

    const membership = tu?.[0];
    if (!membership) {
      return NextResponse.json({ error: 'No tenant found' }, { status: 404 });
    }

    if (membership.role !== 'owner') {
      return NextResponse.json({ error: 'Only the owner can update company settings' }, { status: 403 });
    }

    const body = await request.json();
    const allowedFields = [
      'name', 'company_name', 'description', 'razon_social', 'cuit', 'punto_venta',
      'iva_condition', 'ingresos_brutos', 'inicio_actividades',
      'business_address', 'business_city', 'business_province',
      'business_zip', 'business_phone', 'business_email',
    ];

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field];
      }
    }

    if (updateData.name !== undefined && (!updateData.name || !String(updateData.name).trim())) {
      return NextResponse.json({ error: 'Invalid name' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('tenants')
      .update(updateData)
      .eq('id', auth.tenantId)
      .select()
      .single();

    if (error) {
      { console.error('DB error:', error); return NextResponse.json({ error: 'Ocurrio un error inesperado. Intenta de nuevo.' }, { status: 400 }); }
    }

    return NextResponse.json({ tenant: data });
  } catch (err) {
    console.error('Error updating tenant:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
