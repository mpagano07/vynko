import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { createNotification } from '@/lib/notifications';

async function getOwnersTenant(userId: string): Promise<{ tenantId: string } | null> {
  const { data: tu } = await supabaseAdmin
    .from('tenant_users')
    .select('tenant_id, role')
    .eq('user_id', userId);

  const membership = tu?.[0];
  if (!membership) return null;
  if (membership.role !== 'owner') return null;
  return { tenantId: membership.tenant_id };
}

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: tu } = await supabaseAdmin
      .from('tenant_users')
      .select('tenant_id')
      .eq('user_id', user.id);

    const tenantId = tu?.[0]?.tenant_id;
    if (!tenantId) return NextResponse.json({ error: 'No tenant found' }, { status: 404 });

    const { data: members, error } = await supabaseAdmin
      .from('tenant_users')
      .select('id, role, joined_at, user_id')
      .eq('tenant_id', tenantId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const userIds = (members || []).map((m: any) => m.user_id).filter(Boolean);

    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id, email, full_name, avatar_url')
      .in('id', userIds.length > 0 ? userIds : ['00000000-0000-0000-0000-000000000000']);

    const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));

    const collaborators = (members || []).map((m: any) => {
      const p = profileMap.get(m.user_id);
      return {
        id: m.id,
        user_id: m.user_id,
        role: m.role,
        joined_at: m.joined_at,
        email: p?.email || '',
        full_name: p?.full_name || '',
        avatar_url: p?.avatar_url || null,
      };
    });

    const { data: pendingInvitations } = await supabaseAdmin
      .from('invitations')
      .select('id, email, role, created_at')
      .eq('tenant_id', tenantId)
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
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const ownership = await getOwnersTenant(user.id);
    if (!ownership) {
      return NextResponse.json({ error: 'Only the owner can manage collaborators' }, { status: 403 });
    }

    const body = await request.json();
    const { email, role } = body;

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const validRoles = ['manager', 'member'];
    const assignRole = validRoles.includes(role) ? role : 'member';

    const { data: existingProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, email')
      .eq('email', email)
      .maybeSingle();

    if (existingProfile) {
      const { data: existingMember } = await supabaseAdmin
        .from('tenant_users')
        .select('id')
        .eq('tenant_id', ownership.tenantId)
        .eq('user_id', existingProfile.id)
        .maybeSingle();

      if (existingMember) {
        return NextResponse.json({ error: 'User is already a member of this company' }, { status: 409 });
      }

      const { data: newMember, error: insertError } = await supabaseAdmin
        .from('tenant_users')
        .insert({ tenant_id: ownership.tenantId, user_id: existingProfile.id, role: assignRole })
        .select()
        .single();

      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 400 });
      }

      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('email, full_name, avatar_url')
        .eq('id', existingProfile.id)
        .single();

      await createNotification({
        tenantId: ownership.tenantId,
        type: 'collaborator_joined',
        title: 'Nuevo colaborador',
        message: `${profile?.full_name || email} se unió al equipo como ${assignRole}.`,
        data: { user_id: existingProfile.id, role: assignRole },
      });

      return NextResponse.json({
        collaborator: {
          id: newMember.id,
          user_id: newMember.user_id,
          role: newMember.role,
          joined_at: newMember.joined_at,
          email: profile?.email || email,
          full_name: profile?.full_name || '',
          avatar_url: profile?.avatar_url || null,
        },
      }, { status: 201 });
    }

    const { data: users, error: listError } = await supabaseAdmin.auth.admin.listUsers();
    if (listError) {
      return NextResponse.json({ error: listError.message }, { status: 500 });
    }
    const authUser = users?.users?.find((u: any) => u.email?.toLowerCase() === email.toLowerCase());

    if (authUser) {
      const { data: existingMember } = await supabaseAdmin
        .from('tenant_users')
        .select('id')
        .eq('tenant_id', ownership.tenantId)
        .eq('user_id', authUser.id)
        .maybeSingle();

      if (existingMember) {
        return NextResponse.json({ error: 'User is already a member of this company' }, { status: 409 });
      }

      const { error: createError } = await supabaseAdmin.from('profiles').upsert(
        { id: authUser.id, email: authUser.email, tenant_id: ownership.tenantId },
        { onConflict: 'id' }
      );
      if (createError) {
        return NextResponse.json({ error: createError.message }, { status: 500 });
      }

      const { data: newMember, error: insertError } = await supabaseAdmin
        .from('tenant_users')
        .insert({ tenant_id: ownership.tenantId, user_id: authUser.id, role: assignRole })
        .select()
        .single();

      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 400 });
      }

      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('email, full_name, avatar_url')
        .eq('id', authUser.id)
        .single();

      await createNotification({
        tenantId: ownership.tenantId,
        type: 'collaborator_joined',
        title: 'Nuevo colaborador',
        message: `${profile?.full_name || email} se unió al equipo como ${assignRole}.`,
        data: { user_id: authUser.id, role: assignRole },
      });

      return NextResponse.json({
        collaborator: {
          id: newMember.id,
          user_id: newMember.user_id,
          role: newMember.role,
          joined_at: newMember.joined_at,
          email: profile?.email || email,
          full_name: profile?.full_name || '',
          avatar_url: profile?.avatar_url || null,
        },
      }, { status: 201 });
    }

    const { error: inviteError } = await supabaseAdmin.from('invitations').upsert(
      {
        tenant_id: ownership.tenantId,
        email: email.toLowerCase(),
        role: assignRole,
        invited_by: user.id,
      },
      { onConflict: 'tenant_id,email' }
    );

    if (inviteError) {
      return NextResponse.json({ error: inviteError.message }, { status: 500 });
    }

    const origin = new URL(request.url).origin;
    const { error: inviteEmailError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      email.toLowerCase(),
      { redirectTo: `${origin}/accept-invite` }
    );

    if (inviteEmailError) {
      console.error('Error sending invite email:', inviteEmailError);
    }

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
