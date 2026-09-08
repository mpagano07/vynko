import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { PLAN_LIMITS } from '@/lib/plans';
import type { PlanId } from '@/lib/plans';

interface UserLike {
  id: string;
  email?: string | null;
}

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * Crea la empresa (tenant) del usuario tras confirmar su email. Devuelve el
 * tenantId creado, o null si no se pudo crear (por ejemplo si ya excede el
 * límite de sucursales de su plan).
 */
export async function createCompanyForUser(
  user: UserLike,
  companyName: string,
  ownerName: string
): Promise<string | null> {
  if (!companyName || !ownerName || !user.email) return null;

  const { data: existingMemberships } = await supabaseAdmin
    .from('tenant_users')
    .select('tenant_id')
    .eq('user_id', user.id);

  const existingTenantIds = (existingMemberships ?? []).map((m) => m.tenant_id);

  if (existingTenantIds.length > 0) {
    const { data: existingTenants } = await supabaseAdmin
      .from('tenants')
      .select('subscription_plan')
      .in('id', existingTenantIds);

    const planRank: Record<string, number> = { enterprise: 4, business: 3, starter: 2, free: 1 };
    let bestPlan = 'starter';
    for (const t of existingTenants ?? []) {
      const p = t.subscription_plan || 'starter';
      if ((planRank[p] || 0) > (planRank[bestPlan] || 0)) bestPlan = p;
    }

    const maxBranches = PLAN_LIMITS[bestPlan as PlanId]?.branches ?? 1;
    if (existingTenantIds.length >= maxBranches) {
      return null;
    }
  }

  const tenantId = crypto.randomUUID();
  const tenantSlug = `${slugify(companyName) || 'company'}-${crypto.randomUUID().slice(0, 8)}`;

  const { error: tenantError } = await supabaseAdmin.from('tenants').insert({
    id: tenantId,
    name: companyName,
    slug: tenantSlug,
    subscription_plan: 'starter',
    subscription_status: 'free',
  });

  if (tenantError) {
    console.error('DB error creating tenant:', tenantError);
    return null;
  }

  const { error: profileError } = await supabaseAdmin.from('profiles').upsert(
    {
      id: user.id,
      email: user.email,
      full_name: ownerName,
      tenant_id: tenantId,
    },
    { onConflict: 'id' }
  );

  if (profileError) {
    console.error('DB error creating profile:', profileError);
    return null;
  }

  const { error: tenantUserError } = await supabaseAdmin.from('tenant_users').upsert(
    {
      tenant_id: tenantId,
      user_id: user.id,
      role: 'owner',
    },
    { onConflict: 'tenant_id,user_id' }
  );

  if (tenantUserError) {
    console.error('DB error creating tenant_user:', tenantUserError);
    return null;
  }

  await supabaseAdmin.from('analytics_events').insert({
    event_type: 'signup',
    user_email: user.email,
    user_name: ownerName,
    tenant_id: tenantId,
    metadata: { plan: 'starter' },
  });

  return tenantId;
}
