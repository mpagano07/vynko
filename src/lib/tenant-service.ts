import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { PLAN_LIMITS, NEW_ACCOUNT_PLAN } from '@/lib/plans';
import type { PlanId } from '@/lib/plans';
import type { AuthInfo } from '@/lib/api-auth';
import { canManageTenant } from '@/lib/membership-role';

export type TenantResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; status: number };

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

export async function createTenant(
  auth: AuthInfo,
  body: Record<string, unknown>
): Promise<TenantResult> {
  const name = body.name;

  if (typeof name !== 'string' || !name.trim()) {
    return { ok: false, error: 'El nombre de la sucursal es requerido', status: 400 };
  }

  // Crear una sucursal implica heredar el plan del owner y quedar como `owner`
  // de la nueva: sin este chequeo, un simple 'member' podía abrir sucursales
  // sobre el plan pagado de la empresa.
  if (auth.tenantIds.length > 0) {
    const { data: memberships } = await supabaseAdmin
      .from('tenant_users')
      .select('tenant_id, role')
      .eq('user_id', auth.userId)
      .in('tenant_id', auth.tenantIds);

    const isManagerSomewhere = (memberships ?? []).some((m) => canManageTenant(m.role));
    if (!isManagerSomewhere) {
      return {
        ok: false,
        error: 'Sólo el dueño o un administrador pueden crear sucursales',
        status: 403,
      };
    }
  }

  const tenantId = crypto.randomUUID();
  const tenantSlug = `${slugify(name) || 'sucursal'}-${crypto.randomUUID().slice(0, 8)}`;

  let inheritPlan = NEW_ACCOUNT_PLAN;
  let inheritStatus = 'free';
  let inheritPeriodEnd: string | null = null;
  if (auth.tenantIds.length > 0) {
    const { data: allUserTenants } = await supabaseAdmin
      .from('tenants')
      .select('subscription_plan, subscription_status, subscription_current_period_end')
      .in('id', auth.tenantIds);
    if (allUserTenants && allUserTenants.length > 0) {
      const planRank: Record<string, number> = { enterprise: 4, business: 3, starter: 2, free: 1 };
      const statusRank: Record<string, number> = { active: 5, incomplete: 4, past_due: 3, canceled: 2, free: 1 };
      let bestScore = 0;
      for (const t of allUserTenants) {
        const s = t.subscription_status || 'free';
        const p = t.subscription_plan || 'free';
        const score = (statusRank[s] || 0) + (planRank[p] || 0);
        if (score > bestScore) {
          bestScore = score;
          inheritPlan = p;
          inheritStatus = s;
          inheritPeriodEnd = t.subscription_current_period_end;
        }
      }
    }
  }

  const maxBranches = PLAN_LIMITS[inheritPlan as PlanId]?.branches ?? 1;
  if (auth.tenantIds.length >= maxBranches) {
    return {
      ok: false,
      error: `Tu plan actual (${inheritPlan}) permite hasta ${maxBranches} sucursal${maxBranches !== 1 ? 'es' : ''}.`,
      status: 403,
    };
  }

  const insertData: Record<string, unknown> = {
    id: tenantId,
    name: name.trim(),
    slug: tenantSlug,
    subscription_plan: inheritPlan,
    subscription_status: inheritStatus,
  };
  if (inheritPeriodEnd) {
    insertData.subscription_current_period_end = inheritPeriodEnd;
  }

  const { error: tenantError } = await supabaseAdmin
    .from('tenants')
    .insert(insertData);

  if (tenantError) {
    console.error('DB error:', tenantError);
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
  }

  const { error: tenantUserError } = await supabaseAdmin
    .from('tenant_users')
    .insert({
      tenant_id: tenantId,
      user_id: auth.userId,
      role: 'owner',
    });

  if (tenantUserError) {
    console.error('DB error:', tenantUserError);
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
  }

  const { data: tenantData } = await supabaseAdmin
    .from('tenants')
    .select('*')
    .eq('id', tenantId)
    .single();

  return { ok: true, data: { tenant: tenantData } };
}