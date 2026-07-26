import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(request: Request) {
  try {
    const auth = await getAuth(request);
    if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: ownerTus } = await supabaseAdmin
      .from('tenant_users')
      .select('tenant_id')
      .eq('user_id', auth.userId)
      .eq('role', 'owner');

    const ownerTenantIds = (ownerTus || []).map(t => t.tenant_id as string);
    if (ownerTenantIds.length === 0) {
      return NextResponse.json({ error: 'Only owners can manage collaborators' }, { status: 403 });
    }

    const { data: allMembers } = await supabaseAdmin
      .from('tenant_users')
      .select('id, user_id, role, joined_at, tenant_id')
      .in('tenant_id', ownerTenantIds);

    if (!allMembers) {
      return NextResponse.json({ error: 'Failed to fetch members' }, { status: 500 });
    }

    const userIds = [...new Set(allMembers.map(m => m.user_id as string))].filter(Boolean);
    const tenantIds = [...new Set(allMembers.map(m => m.tenant_id as string))].filter(Boolean);

    const [profilesRes, tenantsRes] = await Promise.all([
      supabaseAdmin
        .from('profiles')
        .select('id, email, full_name, avatar_url')
        .in('id', userIds.length > 0 ? userIds : ['00000000-0000-0000-0000-000000000000']),
      supabaseAdmin
        .from('tenants')
        .select('id, name')
        .in('id', tenantIds.length > 0 ? tenantIds : ['00000000-0000-0000-0000-000000000000']),
    ]);

    const profileMap = new Map((profilesRes.data || []).map(p => [p.id, p]));
    const tenantMap = new Map((tenantsRes.data || []).map(t => [t.id, t]));

    const userTenants: Record<string, { id: string; name: string }[]> = {};
    const userRoles: Record<string, string> = {};
    const userTus: Record<string, string[]> = {};
    for (const m of allMembers) {
      const uid = m.user_id as string;
      if (!userTenants[uid]) userTenants[uid] = [];
      if (!userTus[uid]) userTus[uid] = [];
      const tn = tenantMap.get(m.tenant_id as string);
      if (tn) userTenants[uid].push({ id: tn.id, name: tn.name });
      userTus[uid].push(m.id as string);
      if (m.role === 'owner') userRoles[uid] = 'owner';
      else if (m.role === 'manager' && userRoles[uid] !== 'owner') userRoles[uid] = 'manager';
      else if (!userRoles[uid]) userRoles[uid] = m.role || 'member';
    }

    const collaborators = Object.entries(userTenants).map(([uid, tenants]) => {
        const p = profileMap.get(uid);
        return {
          user_id: uid,
          role: userRoles[uid] || 'member',
          email: p?.email || '',
          full_name: p?.full_name || '',
          avatar_url: p?.avatar_url || null,
          tenants: tenants.sort((a, b) => a.name.localeCompare(b.name)),
          tenant_users_ids: userTus[uid] || [],
        };
      });

    const { data: pendingInvitations } = await supabaseAdmin
      .from('invitations')
      .select('id, email, role, created_at')
      .in('tenant_id', ownerTenantIds)
      .is('accepted_at', null);

    return NextResponse.json({
      collaborators,
      pendingInvitations: pendingInvitations || [],
    });
  } catch (err) {
    console.error('Error listing collaborators:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await getAuth(request);
    if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: ownerTus } = await supabaseAdmin
      .from('tenant_users')
      .select('tenant_id')
      .eq('user_id', auth.userId)
      .eq('role', 'owner');

    const ownerTenantIds = (ownerTus || []).map(t => t.tenant_id as string);
    if (ownerTenantIds.length === 0) {
      return NextResponse.json({ error: 'Only owners can manage collaborators' }, { status: 403 });
    }

    const body = await request.json();
    const { email, role, tenant_ids, full_name } = body;

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const targetTenantIds: string[] = Array.isArray(tenant_ids) && tenant_ids.length > 0
      ? tenant_ids.filter((id: string) => ownerTenantIds.includes(id))
      : ownerTenantIds;

    if (targetTenantIds.length === 0) {
      return NextResponse.json({ error: 'No valid tenants selected' }, { status: 400 });
    }

    const validRoles = ['manager', 'member'];
    const assignRole = validRoles.includes(role) ? role : 'member';
    const assignName = typeof full_name === 'string' && full_name.trim() ? full_name.trim() : null;

    const { data: existingProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, email')
      .eq('email', email)
      .maybeSingle();

    if (existingProfile) {
      if (assignName) {
        await supabaseAdmin
          .from('profiles')
          .update({ full_name: assignName })
          .eq('id', existingProfile.id);
      }

      for (const tid of targetTenantIds) {
        const { data: existingMember } = await supabaseAdmin
          .from('tenant_users')
          .select('id')
          .eq('tenant_id', tid)
          .eq('user_id', existingProfile.id)
          .maybeSingle();

        if (!existingMember) {
          const { error: insertError } = await supabaseAdmin
            .from('tenant_users')
            .insert({ tenant_id: tid, user_id: existingProfile.id, role: assignRole });
          if (insertError) {
            console.error(`Error adding to tenant ${tid}:`, insertError);
          }
        }
      }

      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('email, full_name, avatar_url')
        .eq('id', existingProfile.id)
        .single();

      return NextResponse.json({
        collaborator: {
          user_id: existingProfile.id,
          role: assignRole,
          email: profile?.email || email,
          full_name: profile?.full_name || '',
          avatar_url: profile?.avatar_url || null,
          tenants: [],
        },
      }, { status: 201 });
    }

    const { data: users, error: listError } = await supabaseAdmin.auth.admin.listUsers();
    if (listError) {
      return NextResponse.json({ error: listError.message }, { status: 500 });
    }
    const authUser = users?.users?.find((u: any) => u.email?.toLowerCase() === email.toLowerCase());

    if (authUser) {
      const profileData: Record<string, any> = { id: authUser.id, email: authUser.email, tenant_id: ownerTenantIds[0] };
      if (assignName) profileData.full_name = assignName;
      await supabaseAdmin.from('profiles').upsert(profileData, { onConflict: 'id' });

      for (const tid of targetTenantIds) {
        const { data: existingMember } = await supabaseAdmin
          .from('tenant_users')
          .select('id')
          .eq('tenant_id', tid)
          .eq('user_id', authUser.id)
          .maybeSingle();

        if (!existingMember) {
          await supabaseAdmin
            .from('tenant_users')
            .insert({ tenant_id: tid, user_id: authUser.id, role: assignRole });
        }
      }

      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('email, full_name, avatar_url')
        .eq('id', authUser.id)
        .single();

      return NextResponse.json({
        collaborator: {
          user_id: authUser.id,
          role: assignRole,
          email: profile?.email || email,
          full_name: profile?.full_name || '',
          avatar_url: profile?.avatar_url || null,
          tenants: [],
        },
      }, { status: 201 });
    }

    const { error: inviteError } = await supabaseAdmin.from('invitations').upsert(
      {
        tenant_id: ownerTenantIds[0],
        email: email.toLowerCase(),
        role: assignRole,
        invited_by: auth.userId,
      },
      { onConflict: 'tenant_id,email' }
    );

    if (inviteError) {
      return NextResponse.json({ error: inviteError.message }, { status: 500 });
    }

    const origin = new URL(request.url).origin;
    await supabaseAdmin.auth.admin.inviteUserByEmail(
      email.toLowerCase(),
      { redirectTo: `${origin}/accept-invite` }
    );

    return NextResponse.json({
      invited: true,
      email: email.toLowerCase(),
      message: 'Invitación enviada por email.',
    }, { status: 201 });
  } catch (err) {
    console.error('Error adding collaborator:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
