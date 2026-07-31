import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { PLAN_LIMITS } from '@/lib/plans';
import type { PlanId } from '@/lib/plans';

async function getAuthenticatedUser(request: Request) {
  const authHeader = request.headers.get('authorization');
  const refreshToken = request.headers.get('x-refresh-token');

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.replace('Bearer ', '');
    const authClient = await createServerSupabaseClient();

    const { data: sessionData, error: sessionError } = await authClient.auth.setSession({
      access_token: token,
      refresh_token: refreshToken ?? '',
    });
    if (!sessionData?.session || sessionError) {
      return null;
    }

    const { data: userData, error: userError } = await authClient.auth.getUser();
    if (userError || !userData.user) {
      return null;
    }

    return userData.user;
  }

  const authClient = await createServerSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await authClient.auth.getUser();

  if (userError || !user) {
    return null;
  }

  return user;
}

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user || !user.email) {
      return NextResponse.json({ accepted: 0 });
    }

    const { data: invitations } = await supabaseAdmin
      .from('invitations')
      .select('id, tenant_id, role')
      .eq('email', user.email.toLowerCase())
      .is('accepted_at', null);

    if (!invitations || invitations.length === 0) {
      return NextResponse.json({ accepted: 0 });
    }

    let accepted = 0;
    for (const inv of invitations) {
      const { data: existingMember } = await supabaseAdmin
        .from('tenant_users')
        .select('id')
        .eq('tenant_id', inv.tenant_id)
        .eq('user_id', user.id)
        .maybeSingle();

      if (!existingMember) {
        const { data: tenantRow } = await supabaseAdmin
          .from('tenants')
          .select('subscription_plan')
          .eq('id', inv.tenant_id)
          .single();
        const plan = (tenantRow?.subscription_plan as PlanId) || 'starter';
        const maxUsers = PLAN_LIMITS[plan]?.users ?? 1;
        if (maxUsers !== Infinity) {
          const { count } = await supabaseAdmin
            .from('tenant_users')
            .select('id', { count: 'exact', head: true })
            .eq('tenant_id', inv.tenant_id);
          if ((count ?? 0) >= maxUsers) {
            await supabaseAdmin
              .from('invitations')
              .update({ accepted_at: new Date().toISOString() })
              .eq('id', inv.id);
            continue;
          }
        }
      }

      const { error: upsertError } = await supabaseAdmin.from('profiles').upsert(
        { id: user.id, email: user.email, tenant_id: inv.tenant_id },
        { onConflict: 'id' }
      );
      if (upsertError) continue;

      const { error: tuError } = await supabaseAdmin.from('tenant_users').upsert(
        { tenant_id: inv.tenant_id, user_id: user.id, role: inv.role },
        { onConflict: 'tenant_id,user_id' }
      );
      if (tuError) continue;

      await supabaseAdmin
        .from('invitations')
        .update({ accepted_at: new Date().toISOString() })
        .eq('id', inv.id);

      accepted++;
    }

    return NextResponse.json({ accepted });
  } catch (err) {
    console.error('Error accepting invitations:', err);
    return NextResponse.json({ accepted: 0 }, { status: 500 });
  }
}
