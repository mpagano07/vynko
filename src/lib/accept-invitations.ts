import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { PLAN_LIMITS } from '@/lib/plans';
import type { PlanId } from '@/lib/plans';

interface UserLike {
  id: string;
  email?: string | null;
}

export async function acceptInvitationsForUser(user: UserLike) {
  let accepted = 0;
  if (!user.email) return { accepted };

  const { data: invitations } = await supabaseAdmin
    .from('invitations')
    .select('id, tenant_id, role')
    .eq('email', user.email.toLowerCase())
    .is('accepted_at', null);

  if (!invitations || invitations.length === 0) {
    return { accepted };
  }

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

  return { accepted };
}

export async function getUserTenantIds(userId: string): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from('tenant_users')
    .select('tenant_id')
    .eq('user_id', userId);
  return (data ?? []).map((m) => m.tenant_id);
}
