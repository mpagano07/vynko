import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const auth = await getAuth(_request);
    if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: ownerTus } = await supabaseAdmin
      .from('tenant_users')
      .select('tenant_id')
      .eq('user_id', auth.userId)
      .eq('role', 'owner');

    const ownerTenantIds = (ownerTus || []).map(t => t.tenant_id as string);
    if (ownerTenantIds.length === 0) {
      return NextResponse.json({ error: 'Only owners can remove collaborators' }, { status: 403 });
    }

    const { data: target } = await supabaseAdmin
      .from('tenant_users')
      .select('role, user_id')
      .eq('id', id)
      .in('tenant_id', ownerTenantIds)
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
      .eq('user_id', target.user_id as string)
      .in('tenant_id', ownerTenantIds)
      .neq('role', 'owner');

    if (error) {
      { console.error('DB error:', error); return NextResponse.json({ error: 'Ocurrio un error inesperado. Intenta de nuevo.' }, { status: 400 }); }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Error removing collaborator:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
