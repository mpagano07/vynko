import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { PLAN_LIMITS, NEW_ACCOUNT_PLAN } from '@/lib/plans';
import type { PlanId } from '@/lib/plans';
import { trackEvent } from '@/lib/track-event';
import { logger } from '@/lib/logger';

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
    let bestPlan = NEW_ACCOUNT_PLAN;
    for (const t of existingTenants ?? []) {
      const p = t.subscription_plan || NEW_ACCOUNT_PLAN;
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
    subscription_plan: NEW_ACCOUNT_PLAN,
    subscription_status: 'free',
  });

  if (tenantError) {
    logger.error('DB error creating tenant:', { error: tenantError });
    return null;
  }

  const { error: profileError } = await supabaseAdmin.from('profiles').upsert(
    {
      id: user.id,
      email: user.email,
      full_name: ownerName,
      tenant_id: tenantId,
      onboarding_pending: false,
    },
    { onConflict: 'id' }
  );

  if (profileError) {
    logger.error('DB error creating profile:', { error: profileError });
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
    logger.error('DB error creating tenant_user:', { error: tenantUserError });
    return null;
  }

  // company_created, no signup. Antes este insert graba 'signup', que
  // hacia que "100 registros" en el panel fuera en realidad 100 empresas
  // creadas y no 100 personas registradas: un usuario que abandona el
  // onboarding nunca se contaba, y uno que abre una segunda sucursal
  // contaba dos veces. El 'signup' real se graba en
  // POST /api/auth/signup, donde el alta de la persona ocurre.
  await trackEvent({
    type: 'company_created',
    userId: user.id,
    userEmail: user.email,
    userName: ownerName,
    tenantId,
    metadata: { plan: NEW_ACCOUNT_PLAN },
  });

  // El trial arranca con la empresa: la cuenta nueva cae en Business por
  // 45 dias (PROMOS.business en plans.ts) y checkSubscription cuenta los
  // dias desde tenants.created_at. Se graba aparte de company_created
  // porque son dos hechos distintos y el embudo los necesita separados:
  // hay gente que completa el onboarding mucho despues de que arranco el
  // trial, y esa diferencia es justamente el gap que hay que ver.
  await trackEvent({
    type: 'trial_started',
    userId: user.id,
    userEmail: user.email,
    userName: ownerName,
    tenantId,
    metadata: { plan: NEW_ACCOUNT_PLAN, source: 'create_company' },
  });

  return tenantId;
}
