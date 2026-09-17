import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { PLAN_LIMITS } from '@/lib/plans';
import type { PlanId } from '@/lib/plans';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: targetUserId } = await params;

    const auth = await getAuth(request);
    if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: ownerTus } = await supabaseAdmin
      .from('tenant_users')
      .select('tenant_id')
      .eq('user_id', auth.userId)
      .eq('role', 'owner');

    const ownerTenantIds = (ownerTus || []).map(t => t.tenant_id as string);
    if (ownerTenantIds.length === 0) {
      return NextResponse.json({ error: 'Only owners can edit collaborators' }, { status: 403 });
    }

    if (targetUserId === auth.userId) {
      return NextResponse.json({ error: 'No podés editar tu propio rol' }, { status: 400 });
    }

    const body = await request.json();
    const { role, tenant_ids } = body;

    const validRoles = ['manager', 'member'];
    const newRole = validRoles.includes(role) ? role : 'member';
    const targetTenantIds: string[] = Array.isArray(tenant_ids)
      ? [...new Set(tenant_ids.filter((id: string) => ownerTenantIds.includes(id)))]
      : ownerTenantIds;

    const { data: existingRows } = await supabaseAdmin
      .from('tenant_users')
      .select('id, tenant_id, role')
      .eq('user_id', targetUserId)
      .in('tenant_id', ownerTenantIds);

    if (!existingRows || existingRows.length === 0) {
      return NextResponse.json({ error: 'Collaborator not found in your tenants' }, { status: 404 });
    }

    if (existingRows.some(r => r.role === 'owner')) {
      return NextResponse.json({ error: 'No podés modificar al propietario' }, { status: 400 });
    }

    const currentTenantIds = existingRows.map(r => r.tenant_id as string);
    const toRemoveTenantIds = currentTenantIds.filter(id => !targetTenantIds.includes(id));
    const toAddTenantIds = targetTenantIds.filter(id => !currentTenantIds.includes(id));

    for (const tid of toAddTenantIds) {
      const { data: tenantRow } = await supabaseAdmin
        .from('tenants')
        .select('subscription_plan')
        .eq('id', tid)
        .single();
      const plan = (tenantRow?.subscription_plan as PlanId) || 'starter';
      const maxUsers = PLAN_LIMITS[plan]?.users ?? 1;
      if (maxUsers !== Infinity) {
        const { count } = await supabaseAdmin
          .from('tenant_users')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tid);
        if ((count ?? 0) >= maxUsers) {
          return NextResponse.json({
            error: `La sucursal supera el límite de usuarios de tu plan (${plan}). Mejorá tu plan para asignarla.`,
          }, { status: 403 });
        }
      }
    }

    if (toRemoveTenantIds.length > 0) {
      const { error } = await supabaseAdmin
        .from('tenant_users')
        .delete()
        .eq('user_id', targetUserId)
        .in('tenant_id', toRemoveTenantIds)
        .neq('role', 'owner');
      if (error) {
        { console.error('DB error:', error); return NextResponse.json({ error: 'Ocurrio un error inesperado. Intenta de nuevo.' }, { status: 400 }); }
      }
    }

    if (toAddTenantIds.length > 0) {
      const { error } = await supabaseAdmin
        .from('tenant_users')
        .insert(toAddTenantIds.map(tid => ({
          tenant_id: tid,
          user_id: targetUserId,
          role: newRole,
        })));
      if (error) {
        { console.error('DB error:', error); return NextResponse.json({ error: 'Ocurrio un error inesperado. Intenta de nuevo.' }, { status: 400 }); }
      }
    }

    const { error: updateError } = await supabaseAdmin
      .from('tenant_users')
      .update({ role: newRole })
      .eq('user_id', targetUserId)
      .in('tenant_id', currentTenantIds.filter(id => !toRemoveTenantIds.includes(id)))
      .neq('role', 'owner');

    if (updateError) {
      { console.error('DB error:', updateError); return NextResponse.json({ error: 'Ocurrio un error inesperado. Intenta de nuevo.' }, { status: 400 }); }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Error editing collaborator:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

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
