import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function PATCH(request: Request) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { data: tu } = await supabaseAdmin
      .from('tenant_users')
      .select('tenant_id, role')
      .eq('user_id', user.id);

    const membership = tu?.[0];
    if (!membership) {
      return NextResponse.json({ error: 'No tenant found' }, { status: 404 });
    }

    if (membership.role !== 'owner') {
      return NextResponse.json({ error: 'Only the owner can update company settings' }, { status: 403 });
    }

    const body = await request.json();
    const { name, description } = body;

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        return NextResponse.json({ error: 'Invalid company name' }, { status: 400 });
      }
      updateData.name = name.trim();
    }

    if (description !== undefined) {
      updateData.description = description;
    }

    const { data, error } = await supabaseAdmin
      .from('tenants')
      .update(updateData)
      .eq('id', membership.tenant_id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ tenant: data });
  } catch (err) {
    console.error('Error updating tenant:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
