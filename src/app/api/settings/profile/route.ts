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

    const body = await request.json();
    const { full_name } = body;

    if (!full_name || typeof full_name !== 'string') {
      return NextResponse.json({ error: 'full_name is required' }, { status: 400 });
    }

    const { data: tenantUser } = await supabaseAdmin
      .from('tenant_users')
      .select('tenant_id')
      .eq('user_id', user.id)
      .maybeSingle();

    const { data, error } = await supabaseAdmin
      .from('profiles')
      .upsert({
        id: user.id,
        full_name: full_name.trim(),
        email: user.email,
        tenant_id: tenantUser?.tenant_id || null,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      { console.error('DB error:', error); return NextResponse.json({ error: 'Ocurrio un error inesperado. Intenta de nuevo.' }, { status: 400 }); }
    }

    return NextResponse.json({ profile: data });
  } catch (err) {
    console.error('Error updating profile:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
