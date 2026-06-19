import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: ownerTu } = await supabaseAdmin
      .from('tenant_users')
      .select('tenant_id, role')
      .eq('user_id', user.id);

    const ownership = ownerTu?.[0];
    if (!ownership || ownership.role !== 'owner') {
      return NextResponse.json({ error: 'Only the owner can remove collaborators' }, { status: 403 });
    }

    const { data: target } = await supabaseAdmin
      .from('tenant_users')
      .select('role, user_id')
      .eq('id', id)
      .eq('tenant_id', ownership.tenant_id)
      .single();

    if (!target) {
      return NextResponse.json({ error: 'Collaborator not found' }, { status: 404 });
    }

    if (target.role === 'owner') {
      return NextResponse.json({ error: 'Cannot remove the owner' }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from('tenant_users')
      .delete()
      .eq('id', id)
      .eq('tenant_id', ownership.tenant_id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Error removing collaborator:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
